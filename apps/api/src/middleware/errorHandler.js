import { mongoose } from '@pulseboard/shared/db';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

/** Converts any thrown error into the API's single error shape: { error: { code, message, details? } }. */
export function toErrorResponse(err) {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid request', details };
  }
  if (err instanceof mongoose.Error.CastError) {
    return { status: 400, code: 'BAD_REQUEST', message: `Invalid value for ${err.path}` };
  }
  if (err?.code === 11000) {
    const fields = Object.keys(err.keyValue ?? err.keyPattern ?? {});
    return { status: 409, code: 'CONFLICT', message: 'Duplicate value', details: { fields } };
  }
  // body-parser errors (malformed JSON, payload too large) carry a status.
  if (err?.type === 'entity.parse.failed') {
    return { status: 400, code: 'BAD_REQUEST', message: 'Malformed JSON body' };
  }
  if (err?.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' };
  }
  return { status: 500, code: 'INTERNAL', message: 'Something went wrong' };
}

// Express recognises error handlers by their 4-argument signature.
export function errorHandler(err, req, res, _next) {
  const { status, code, message, details } = toErrorResponse(err);
  if (status >= 500) req.log?.error({ err }, 'Unhandled error');
  res.status(status).json({ error: { code, message, ...(details && { details }) } });
}
