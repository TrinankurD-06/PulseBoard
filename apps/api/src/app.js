import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createAlertSenders } from '@pulseboard/shared/alerts';
import { alertSenderConfig } from '@pulseboard/shared/env';
import { createIncidentEngine } from '@pulseboard/shared/incident';
import { buildMonitorSchemas } from '@pulseboard/shared/schemas';
import { pinoHttp } from 'pino-http';
import { createTokenService } from './lib/tokens.js';
import { createTtlCache } from './lib/ttlCache.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sanitizeBody } from './middleware/sanitize.js';
import { alertChannelsRouter } from './modules/alertChannels/alertChannels.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { githubRouter } from './modules/github/github.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { incidentsRouter } from './modules/incidents/incidents.routes.js';
import { membersRouter } from './modules/members/members.routes.js';
import { metaRouter } from './modules/meta/meta.routes.js';
import { monitorAnalyticsRouter } from './modules/monitors/analytics.routes.js';
import { monitorsRouter } from './modules/monitors/monitors.routes.js';
import { pingRouter } from './modules/ping/ping.routes.js';
import { agentRouter } from './modules/agent/agent.routes.js';
import { PUBLIC_CACHE_SECONDS, publicRouter } from './modules/public/public.routes.js';
import { statusPagesRouter } from './modules/statusPages/statusPages.routes.js';
import { workspacesRouter } from './modules/workspaces/workspaces.routes.js';
import { noopScheduler } from './scheduling/scheduler.js';

/**
 * Builds the Express app without listening, so tests can drive it with Supertest.
 * Process-level concerns (DB connection, sockets, shutdown) live in server.js.
 */
export function createApp({
  env,
  logger,
  scheduler = noopScheduler,
  // Agenda instance (never started) used to queue alert jobs when a heartbeat
  // ping opens or resolves an incident. Without one, alerts from pings are skipped.
  agenda = null,
  alertSenders = createAlertSenders({ ...alertSenderConfig(env), logger }),
  getRealtimeStatus,
  getWorkerStatus,
  // fetch used to talk to OAuth providers (tests pass a fake).
  oauthFetch = globalThis.fetch,
  // fetch used for the GitHub REST API, and the reachability probe for candidate
  // URLs (default: the real HEAD check). Tests pass fakes.
  githubFetch = globalThis.fetch,
  githubProbe,
}) {
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
        // OAuth callbacks carry a one-time code in the query: log the path only.
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url.includes('/auth/oauth/') ? req.url.split('?')[0] : req.url,
        }),
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

  app.use('/health', healthRouter({ getRealtimeStatus, getWorkerStatus }));

  const tokens = createTokenService(env);
  const requireAuth = authenticate(tokens);

  const monitorSchemas = buildMonitorSchemas({ demoMode: env.DEMO_MODE });
  // Shared by the public endpoint (reads) and status page CRUD (invalidates).
  const publicCache = createTtlCache({ ttlMs: PUBLIC_CACHE_SECONDS * 1000 });

  const processCheckResult = createIncidentEngine({
    agenda: agenda ?? {
      now: async (name) => logger.warn({ job: name }, 'No Agenda instance: alert job not queued'),
    },
    logger,
  });

  const api = express.Router();
  api.use('/meta', metaRouter({ env, schemas: monitorSchemas }));
  api.use('/auth', authRouter({ env, tokens, logger, oauthFetch }));
  api.use('/public', publicRouter({ publicCache }));
  // Heartbeat pings: public, the token in the URL is the authentication.
  api.use('/ping', pingRouter({ processCheckResult }));
  // Agent reports (U4): public, the Bearer agent key is the authentication.
  api.use('/agent', agentRouter({ processCheckResult }));
  api.use('/workspaces', requireAuth, workspacesRouter({ scheduler, env }));
  api.use('/workspaces/:wid/members', requireAuth, membersRouter());
  // Analytics first: its '/sparklines' must not be captured by the CRUD router's '/:mid'.
  api.use('/workspaces/:wid/monitors', requireAuth, monitorAnalyticsRouter());
  api.use(
    '/workspaces/:wid/monitors',
    requireAuth,
    monitorsRouter({ env, scheduler, schemas: monitorSchemas }),
  );
  api.use(
    '/workspaces/:wid/github',
    requireAuth,
    githubRouter({
      env,
      scheduler,
      schemas: monitorSchemas,
      publicCache,
      githubFetch,
      githubProbe,
    }),
  );
  api.use('/workspaces/:wid/incidents', requireAuth, incidentsRouter());
  api.use(
    '/workspaces/:wid/alert-channels',
    requireAuth,
    alertChannelsRouter({ senders: alertSenders, env }),
  );
  api.use('/workspaces/:wid/status-pages', requireAuth, statusPagesRouter({ publicCache }));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
