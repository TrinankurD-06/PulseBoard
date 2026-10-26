import {
  connectMongo,
  disconnectMongo,
  ensureCollections,
  mongoState,
} from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import { env } from './config/env.js';
import { startHealthServer } from './healthServer.js';

const logger = createLogger({ name: 'worker' });

async function main() {
  await connectMongo(env.MONGODB_URI, logger);
  await ensureCollections();

  // Agenda job processing is added in phase 4.
  const healthServer = startHealthServer({
    port: env.WORKER_HEALTH_PORT,
    logger,
    getStatus: async () => {
      const mongo = mongoState();
      return { healthy: mongo === 'connected', mongo, agenda: 'not_started' };
    },
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    healthServer.close();
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
