import os from 'node:os';
import { createAlertSenders } from '@pulseboard/shared/alerts';
import { JOB_NAMES, MAX_TIMEOUT_MS } from '@pulseboard/shared/constants';
import {
  connectMongo,
  disconnectMongo,
  ensureCollections,
  mongoose,
  mongoState,
} from '@pulseboard/shared/db';
import { alertSenderConfig } from '@pulseboard/shared/env';
import { createLogger } from '@pulseboard/shared/logger';
import {
  countOverdueJobs,
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { env } from './config/env.js';
import { startHealthServer } from './healthServer.js';
import { createIncidentEngine } from './incidents/engine.js';
import { createFinalizeRollupJob, createRollupJob } from './jobs/rollups.js';
import { createRunCheckJob } from './jobs/runCheck.js';
import { createSendAlertJob } from './jobs/sendAlert.js';
import { reconcileJobs } from './reconcile.js';

const logger = createLogger({ name: 'worker' });

async function main() {
  await connectMongo(env.MONGODB_URI, logger);
  await ensureCollections();

  const { agenda, close: closeAgenda } = createAgenda({
    mongoUri: env.MONGODB_URI,
    name: `worker-${os.hostname()}-${process.pid}`,
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

  const processCheckResult = createIncidentEngine({ agenda, logger });
  agenda.define(
    JOB_NAMES.RUN_CHECK,
    createRunCheckJob({
      allowPrivate: env.ALLOW_PRIVATE_TARGETS,
      scheduler,
      processCheckResult,
      logger,
    }),
    { concurrency: env.AGENDA_MAX_CONCURRENCY },
  );
  agenda.define(
    JOB_NAMES.SEND_ALERT,
    createSendAlertJob({
      agenda,
      senders: createAlertSenders({ ...alertSenderConfig(env), logger }),
      dashboardUrl: env.DASHBOARD_URL,
      logger,
    }),
    { concurrency: 5 },
  );
  agenda.define(JOB_NAMES.ROLLUP, createRollupJob({ logger }));
  agenda.define(JOB_NAMES.FINALIZE_ROLLUP, createFinalizeRollupJob({ logger }));
  agenda.on('fail', (err, job) => logger.error({ err, job: job.attrs.name }, 'Job failed'));

  await reconcileJobs({ db: mongoose.connection.db, scheduler, logger });
  await agenda.start();
  // every() creates a single job per name (upsert), so several workers booting
  // at once still end up with one rollup job and one nightly finalize job.
  await agenda.every('15 minutes', JOB_NAMES.ROLLUP);
  await agenda.every('5 0 * * *', JOB_NAMES.FINALIZE_ROLLUP, undefined, { timezone: 'UTC' });
  let agendaRunning = true;
  logger.info('Agenda started, processing jobs');

  const healthServer = startHealthServer({
    port: env.WORKER_HEALTH_PORT,
    logger,
    getStatus: async () => {
      const mongo = mongoState();
      const healthy = mongo === 'connected' && agendaRunning;
      const overdueJobs = healthy ? await countOverdueJobs(mongoose.connection.db) : null;
      return { healthy, mongo, agenda: agendaRunning ? 'running' : 'stopped', overdueJobs };
    },
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    healthServer.close();
    // Unlocks jobs this worker holds, so another worker can pick them up immediately
    // instead of waiting for the lock to expire.
    agendaRunning = false;
    await closeAgenda();
    await disconnectMongo();
    logger.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
