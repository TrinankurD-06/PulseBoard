/**
 * Removes keys that MongoDB would interpret as operators ("$gt") or paths
 * ("a.b") from request bodies, so user input can never become a query operator.
 *
 * req.query needs no sanitising: Express 5's default "simple" query parser
 * never produces nested objects, so `?email[$ne]=x` arrives as a plain string key.
 */
export function stripMongoOperators(value) {
  if (Array.isArray(value)) return value.map(stripMongoOperators);
  if (value === null || typeof value !== 'object') return value;

  const clean = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    clean[key] = stripMongoOperators(inner);
  }
  return clean;
}

export function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') req.body = stripMongoOperators(req.body);
  next();
}
