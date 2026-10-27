import { JOB_NAMES } from '@pulseboard/shared/constants';
import { mongoose } from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import { AGENDA_COLLECTION } from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startWorker } from '../src/worker.js';

const logger = createLogger({ name: 'worker-start-test' });
let replSet, jobs, env;

beforeAll(async () => {
  replSet = await startMemoryDb();
  jobs = mongoose.connection.db.collection(AGENDA_COLLECTION);
  env = {
    MONGODB_URI: replSet.getUri('pulseboard-test'),
    ALLOW_PRIVATE_TARGETS: false,
    AGENDA_MAX_CONCURRENCY: 5,
    DASHBOARD_URL: 'http://localhost:5173',
    SMTP_HOST: '',
    SMTP_PORT: 587,
    SMTP_USER: '',
    SMTP_PASS: '',
    ALERT_FROM_EMAIL: 'PulseBoard <alerts@pulseboard.local>',
  };
});

afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const RECURRING = [
  JOB_NAMES.ROLLUP,
  JOB_NAMES.HEARTBEAT_OVERDUE,
  JOB_NAMES.AGENT_SILENCE,
  JOB_NAMES.FINALIZE_ROLLUP,
  JOB_NAMES.BUDGET_RESET,
];

describe('startWorker', () => {
  it('starts processing, creates each recurring job once, and stops cleanly', async () => {
    // Two runners booting together (a standalone worker beside a combined API)
    // must still leave exactly one recurring job per name.
    const first = await startWorker({ env, logger, agendaName: 'start-test-a' });
    const second = await startWorker({ env, logger, agendaName: 'start-test-b' });
    try {
      expect(first.isRunning()).toBe(true);
      for (const name of RECURRING) {
        expect(await jobs.countDocuments({ name }), name).toBe(1);
      }
    } finally {
      await first.stop();
      expect(first.isRunning()).toBe(false);
      await second.stop();
    }
  });

  it('actually runs a queued job with the handlers it defined', async () => {
    const worker = await startWorker({ env, logger, agendaName: 'start-test-run' });
    try {
      // A one-off job is deleted once it completes (removeOnComplete), so it
      // disappearing proves a handler ran it. The recurring doc has another type.
      await worker.agenda.now(JOB_NAMES.BUDGET_RESET);
      const deadline = Date.now() + 20_000;
      let pending = await jobs.countDocuments({ name: JOB_NAMES.BUDGET_RESET, type: 'normal' });
      while (pending > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        pending = await jobs.countDocuments({ name: JOB_NAMES.BUDGET_RESET, type: 'normal' });
      }
      expect(pending).toBe(0);
    } finally {
      await worker.stop();
    }
  }, 30_000);
});
