/**
 * Validates req.body / req.query / req.params against Zod schemas.
 * Parsed (coerced, defaulted, stripped) values are put on req.valid, because
 * Express 5 makes req.query read-only.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    req.valid = {};
    for (const part of ['params', 'query', 'body']) {
      if (schemas[part]) req.valid[part] = schemas[part].parse(req[part] ?? {});
    }
    next();
  };
}
