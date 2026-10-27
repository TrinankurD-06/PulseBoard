import http from 'node:http';
import { connectMongo, disconnectMongo, ensureCollections, mongoose } from '@pulseboard/shared/db';
import { createLogger } from '@pulseboard/shared/logger';
import {
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { createTokenService } from './lib/tokens.js';
import { startRealtime } from './realtime/index.js';
import { createSocketServer } from './realtime/socketServer.js';

const logger = createLogger({ name: 'api' });

async function main() {
  await connectMongo(env.MONGODB_URI, logger);
  await ensureCollections();

  // The API only *writes* jobs. It never calls agenda.start(), so it never runs
  // checks; the worker process does.
  const { agenda, close: closeAgenda } = createAgenda({ mongoUri: env.MONGODB_URI, name: 'api' });
  await agenda.ready;
  await ensureAgendaIndexes(mongoose.connection.db);
  const scheduler = createAgendaScheduler(agenda);

  let realtime = null;
  const app = createApp({
    env,
    logger,
    scheduler,
    agenda,
    getRealtimeStatus: () => realtime?.status() ?? 'not_started',
  });
  const server = http.createServer(app);

  // Socket.io shares the HTTP server; change streams feed it worker updates.
  const io = createSocketServer(server, { env, tokens: createTokenService(env), logger });
  realtime = startRealtime({ io, db: mongoose.connection.db, logger });
  await realtime.ready;

  server.listen(env.API_PORT, () => logger.info(`API listening on :${env.API_PORT}`));

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    // Stop change streams and sockets, let in-flight requests finish, then close the DB.
    await realtime.close();
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
