import { unauthorized } from '../lib/errors.js';

/** Requires a valid "Authorization: Bearer <access token>" header and sets req.userId. */
export function authenticate(tokens) {
  return (req, _res, next) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    const userId = scheme === 'Bearer' && token ? tokens.verifyAccessToken(token) : null;
    if (!userId) throw unauthorized('Missing or invalid access token');
    req.userId = userId;
    next();
  };
}
