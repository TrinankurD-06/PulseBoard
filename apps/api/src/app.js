import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { createTokenService } from './lib/tokens.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sanitizeBody } from './middleware/sanitize.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { membersRouter } from './modules/members/members.routes.js';
import { workspacesRouter } from './modules/workspaces/workspaces.routes.js';

/**
 * Builds the Express app without listening, so tests can drive it with Supertest.
 * Process-level concerns (DB connection, sockets, shutdown) live in server.js.
 */
export function createApp({ env, logger, getRealtimeStatus }) {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      // Reuse an upstream request id if a proxy set one, so logs correlate end to end.
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'] || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
      // Keep request logs to one readable line; headers would mostly be noise.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  // An array (not a string) makes cors omit the header entirely for other origins.
  app.use(cors({ origin: [env.CLIENT_ORIGIN], credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeBody);

  app.use('/health', healthRouter({ getRealtimeStatus }));

  const tokens = createTokenService(env);
  const requireAuth = authenticate(tokens);

  const api = express.Router();
  api.use('/auth', authRouter({ env, tokens, logger }));
  api.use('/workspaces', requireAuth, workspacesRouter());
  api.use('/workspaces/:wid/members', requireAuth, membersRouter());
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
