import {
  connectMongo,
  disconnectMongo,
  ensureCollections,
  mongoose,
  mongoState,
} from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import { countOverdueJobs } from '@pulseboard/shared/scheduling';
import { env } from './config/env.js';
import { startHealthServer } from './healthServer.js';
import { startWorker } from './worker.js';

const logger = createLogger({ name: 'worker' });

// The standalone worker process. The same runner can also live inside the API
// (RUN_MODE=combined, see apps/api/src/combined.js).
async function main() {
  await connectMongo(env.MONGODB_URI, logger);
  await ensureCollections();
  const worker = await startWorker({ env, logger });

  const healthServer = startHealthServer({
    port: env.WORKER_HEALTH_PORT,
    logger,
    getStatus: async () => {
      const mongo = mongoState();
      const agendaRunning = worker.isRunning();
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
    await worker.stop();
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
