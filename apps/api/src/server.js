import http from 'node:http';
import { connectMongo, disconnectMongo, ensureCollections } from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import { createApp } from './app.js';
import { env } from './config/env.js';

const logger = createLogger({ name: 'api' });

async function main() {
  await connectMongo(env.MONGODB_URI, logger);
  await ensureCollections();

  const app = createApp({ env, logger });
  const server = http.createServer(app);
  server.listen(env.API_PORT, () => logger.info(`API listening on :${env.API_PORT}`));

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    // Stop accepting new connections, let in-flight requests finish, then close the DB.
    server.close();
    server.closeIdleConnections?.();
    await disconnectMongo();
    logger.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
