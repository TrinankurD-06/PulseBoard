import os from 'node:os';
import { createAlertSenders } from '@pulseboard/shared/alerts';
import { JOB_NAMES, MAX_TIMEOUT_MS } from '@pulseboard/shared/constants';
import { mongoose } from '@pulseboard/shared/db';
import { alertSenderConfig, appUrlOf } from '@pulseboard/shared/env';
import { createIncidentEngine } from '@pulseboard/shared/incident';
import {
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { createAgentProber } from './agentProbes.js';
import { createBudgetEnforcer } from './budget.js';
import { createAgentSilenceJob } from './jobs/agentSilence.js';
import { createBudgetResetJob } from './jobs/budgetReset.js';
import { createHeartbeatOverdueJob } from './jobs/heartbeatOverdue.js';
import { createFinalizeRollupJob, createRollupJob } from './jobs/rollups.js';
import { createRunCheckJob } from './jobs/runCheck.js';
import { createSendAlertJob } from './jobs/sendAlert.js';
import { createSendNoticeJob } from './jobs/sendNotice.js';
import { reconcileJobs } from './reconcile.js';

/**
 * Starts the job runner: Agenda with every job handler, the boot-time catch-up
 * and reconciliation, and the recurring jobs. MongoDB must already be connected.
 *
 * Used by the standalone worker (`apps/worker/src/index.js`) and, when
 * RUN_MODE=combined, by the API process itself. `env` needs MONGODB_URI,
 * ALLOW_PRIVATE_TARGETS, AGENDA_MAX_CONCURRENCY and the alert settings.
 *
 * Returns { agenda, isRunning(), stop() }; stop() releases the jobs this runner
 * holds so another runner can pick them up at once.
 */
export async function startWorker({
  env,
  logger,
  agendaName = `worker-${os.hostname()}-${process.pid}`,
}) {
  const { agenda, close: closeAgenda } = createAgenda({
    mongoUri: env.MONGODB_URI,
    name: agendaName,
    maxConcurrency: env.AGENDA_MAX_CONCURRENCY,
    // Comfortably above the longest possible check, so a slow check is never
    // mistaken for a dead worker and handed to someone else.
    defaultLockLifetime: MAX_TIMEOUT_MS * 2,
    // One-off jobs (alerts) are deleted once done, so agendaJobs doesn't grow forever.
    removeOnComplete: true,
  });
  await agenda.ready;
  await ensureAgendaIndexes(mongoose.connection.db);
  const scheduler = createAgendaScheduler(agenda);

  const db = mongoose.connection.db;
  const processCheckResult = createIncidentEngine({ agenda, logger });
  const enforceBudget = createBudgetEnforcer({ agenda, db, scheduler, logger });
  const senders = createAlertSenders({ ...alertSenderConfig(env), logger });
  const prober = createAgentProber({
    allowPrivate: env.ALLOW_PRIVATE_TARGETS,
    appUrl: appUrlOf(env),
    agenda,
    processCheckResult,
    logger,
  });
  agenda.define(
    JOB_NAMES.RUN_CHECK,
    createRunCheckJob({
      allowPrivate: env.ALLOW_PRIVATE_TARGETS,
      appUrl: appUrlOf(env),
      db,
      scheduler,
      processCheckResult,
      enforceBudget,
      logger,
      prober,
    }),
    { concurrency: env.AGENDA_MAX_CONCURRENCY },
  );
  agenda.define(
    JOB_NAMES.SEND_ALERT,
    createSendAlertJob({ agenda, senders, dashboardUrl: env.DASHBOARD_URL, logger }),
    { concurrency: 5 },
  );
  agenda.define(
    JOB_NAMES.SEND_NOTICE,
    createSendNoticeJob({ agenda, senders, dashboardUrl: env.DASHBOARD_URL, logger }),
    { concurrency: 5 },
  );
  const budgetReset = createBudgetResetJob({ scheduler, logger });
  agenda.define(JOB_NAMES.BUDGET_RESET, () => budgetReset(new Date()));
  const heartbeatOverdue = createHeartbeatOverdueJob({ processCheckResult, logger });
  agenda.define(JOB_NAMES.HEARTBEAT_OVERDUE, () => heartbeatOverdue(new Date()));
  const agentSilence = createAgentSilenceJob({ prober, processCheckResult, logger });
  agenda.define(JOB_NAMES.AGENT_SILENCE, (job) =>
    agentSilence(new Date(), { touch: () => job.touch() }),
  );
  agenda.define(JOB_NAMES.ROLLUP, createRollupJob({ logger }));
  agenda.define(JOB_NAMES.FINALIZE_ROLLUP, createFinalizeRollupJob({ logger }));
  agenda.on('fail', (err, job) => logger.error({ err, job: job.attrs.name }, 'Job failed'));

  // Catch up on a missed monthly reset first, so reconcile sees the restored intervals.
  await budgetReset(new Date());
  await reconcileJobs({ db, scheduler, logger });
  await agenda.start();
  // every() creates a single job per name (upsert), so several runners booting
  // at once still end up with one rollup job and one nightly finalize job.
  await agenda.every('15 minutes', JOB_NAMES.ROLLUP);
  await agenda.every('30 seconds', JOB_NAMES.HEARTBEAT_OVERDUE);
  await agenda.every('30 seconds', JOB_NAMES.AGENT_SILENCE);
  await agenda.every('5 0 * * *', JOB_NAMES.FINALIZE_ROLLUP, undefined, { timezone: 'UTC' });
  await agenda.every('0 0 1 * *', JOB_NAMES.BUDGET_RESET, undefined, { timezone: 'UTC' });
  let running = true;
  logger.info('Agenda started, processing jobs');

  return {
    agenda,
    isRunning: () => running,
    async stop() {
      running = false;
      await closeAgenda();
    },
  };
}
