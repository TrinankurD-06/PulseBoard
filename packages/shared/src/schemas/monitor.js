import { z } from 'zod';
import {
  DEFAULT_EXPECTED_STATUS,
  DEFAULT_TIMEOUT_MS,
  HTTP_METHODS,
  MAX_INTERVAL_SEC,
  MAX_TIMEOUT_MS,
  MIN_INTERVAL_SEC,
  MIN_INTERVAL_SEC_DEMO,
} from '../constants.js';

// Headers the HTTP client must control itself; letting users set them could
// break requests or smuggle a second request.
const FORBIDDEN_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'te',
  'trailer',
  'keep-alive',
]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/; // RFC 7230 "token"

const headersSchema = z
  .record(z.string(), z.string().max(1000))
  .refine((headers) => Object.keys(headers).length <= 20, 'At most 20 headers')
  .refine(
    (headers) => Object.keys(headers).every((name) => HEADER_NAME.test(name)),
    'Header names may only contain letters, digits and - _ . etc.',
  )
  .refine(
    (headers) => Object.keys(headers).every((name) => !FORBIDDEN_HEADERS.has(name.toLowerCase())),
    'Host, Content-Length, Connection and similar headers cannot be overridden',
  );

const urlSchema = z
  .string()
  .trim()
  .max(2048)
  // abort: a malformed URL shouldn't also report the protocol rule below.
  .url({ message: 'Enter a full URL, e.g. https://example.com', abort: true })
  .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://');

export const expectedStatusSchema = z
  .object({
    min: z.coerce.number().int().min(100).max(599),
    max: z.coerce.number().int().min(100).max(599),
  })
  .refine((range) => range.min <= range.max, {
    message: 'Minimum must not be greater than maximum',
    path: ['max'],
  });

/** Empty strings from forms mean "no keyword". */
const keywordSchema = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((value) => value || null);

/**
 * Monitor schemas depend on whether DEMO_MODE is on (10s minimum interval
 * instead of 30s), so they are built by a factory.
 */
export function buildMonitorSchemas({ demoMode = false } = {}) {
  const minIntervalSec = demoMode ? MIN_INTERVAL_SEC_DEMO : MIN_INTERVAL_SEC;

  // No .default() here: Zod 4 applies defaults even inside .partial(), which would
  // make a PATCH of { name } silently reset method/timeout/expectedStatus.
  const fields = z.object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    url: urlSchema,
    method: z.enum(HTTP_METHODS),
    intervalSec: z.coerce
      .number()
      .int()
      .min(minIntervalSec, `Interval must be at least ${minIntervalSec} seconds`)
      .max(MAX_INTERVAL_SEC),
    timeoutMs: z.coerce.number().int().min(1000).max(MAX_TIMEOUT_MS),
    expectedStatus: expectedStatusSchema,
    keyword: keywordSchema,
    headers: headersSchema.optional(),
  });

  const withDefaults = fields.extend({
    method: fields.shape.method.default('GET'),
    timeoutMs: fields.shape.timeoutMs.default(DEFAULT_TIMEOUT_MS),
    expectedStatus: fields.shape.expectedStatus.default({ ...DEFAULT_EXPECTED_STATUS }),
  });

  // A check must finish before the next one is due.
  const timeoutFitsInterval = (monitor, ctx) => {
    if (monitor.timeoutMs > monitor.intervalSec * 1000) {
      ctx.addIssue({
        code: 'custom',
        path: ['timeoutMs'],
        message: 'Timeout must not be longer than the check interval',
      });
    }
  };

  return {
    minIntervalSec,
    create: withDefaults.superRefine(timeoutFitsInterval),
    // PATCH bodies are partial; the service re-validates the merged result with `create`.
    update: fields.partial().refine((patch) => Object.keys(patch).length > 0, 'Nothing to update'),
  };
}
