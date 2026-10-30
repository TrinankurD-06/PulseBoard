import { redactMessage } from '@pulseboard/shared/alerts';
import { ErrorLog } from '@pulseboard/shared/models';

const OBJECT_ID_SEGMENT = /\/[a-f\d]{24}(?=\/|$)/gi;

/** "/api/v1/workspaces/:wid/monitors/:mid": the route pattern, never a URL with real ids or a query. */
export function routePattern(req) {
  const path = `${req.baseUrl ?? ''}${req.route?.path ?? ''}` || req.path || '';
  return path.replace(OBJECT_ID_SEGMENT, '/:id').slice(0, 200);
}

/** Best effort and fire-and-forget: recording an error must never cause another one. */
export function recordServerError(req, { status, code, message }) {
  ErrorLog.create({
    method: req.method,
    route: routePattern(req),
    status,
    code,
    message: redactMessage(message, 200),
  }).catch(() => {});
}
