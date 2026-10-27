import http from 'node:http';
import { connectMongo, disconnectMongo, ensureCollections, mongoose } from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import {
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { createApp } from './app.js';
import { startCombinedWorker } from './combined.js';
import { env } from './config/env.js';
import { createTokenService } from './lib/tokens.js';
import { startRealtime } from './realtime/index.js';
import { createSocketServer } from './realtime/socketServer.js';

const logger = createLogger({ name: 'api' });

async function main() {
  await connectMongo(env.MONGODB_URI, logger);
  await ensureCollections();

  // This instance only *writes* jobs and never calls agenda.start(). Checks run
  // in the worker: a separate process, or (RUN_MODE=combined) the one started below.
  const { agenda, close: closeAgenda } = createAgenda({ mongoUri: env.MONGODB_URI, name: 'api' });
  await agenda.ready;
  await ensureAgendaIndexes(mongoose.connection.db);
  const scheduler = createAgendaScheduler(agenda);

  let realtime = null;
  let worker = null;
  const app = createApp({
    env,
    logger,
    scheduler,
    agenda,
    getRealtimeStatus: () => realtime?.status() ?? 'not_started',
    getWorkerStatus: () =>
      env.RUN_MODE !== 'combined' ? 'off' : worker?.isRunning() ? 'running' : 'stopped',
  });
  const server = http.createServer(app);

  // Socket.io shares the HTTP server; change streams feed it worker updates.
  const io = createSocketServer(server, { env, tokens: createTokenService(env), logger });
  realtime = startRealtime({ io, db: mongoose.connection.db, logger });
  await realtime.ready;

  server.listen(env.API_PORT, () => logger.info(`API listening on :${env.API_PORT}`));

  // After listen: the port is bound for the platform's health check while the
  // worker reconciles jobs. A failure here is fatal, like a standalone worker.
  worker = await startCombinedWorker({ env, logger });
  if (worker) logger.info('RUN_MODE=combined: worker running inside the API process');

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    // Stop change streams and sockets, let in-flight requests finish, then close the DB.
    await realtime.close();
    await worker?.stop(); // releases held jobs so another runner can take them at once
    io.close(); // also closes the HTTP server and disconnects sockets
    server.closeIdleConnections?.();
    await closeAgenda();
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
