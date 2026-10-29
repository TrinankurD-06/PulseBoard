import { z } from 'zod';
import {
  AGENT_DEFAULT_ERROR_RATE_THRESHOLD,
  AGENT_DEFAULT_REPORT_EVERY_SEC,
  AGENT_MAX_EXTERNAL_CHECK_SEC,
  AGENT_MAX_REPORT_EVERY_SEC,
  AGENT_MIN_EXTERNAL_CHECK_SEC,
  AGENT_MIN_REPORT_EVERY_SEC,
  MONITOR_TYPES,
} from '../constants.js';

/** Empty form inputs mean "not set". */
const emptyToNull = (schema) =>
  z.preprocess((value) => (value === '' || value === undefined ? null : value), schema);

const probeUrlSchema = emptyToNull(
  z
    .string()
    .trim()
    .max(2048)
    .url({ message: 'Enter a full URL, e.g. https://example.com/health', abort: true })
    .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://')
    .nullable(),
);

// No .default() here: Zod 4 applies defaults inside .partial() too (see monitor.js).
const agentFields = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  reportEverySec: z.coerce
    .number()
    .int()
    .min(
      AGENT_MIN_REPORT_EVERY_SEC,
      `Report interval must be at least ${AGENT_MIN_REPORT_EVERY_SEC} seconds`,
    )
    .max(
      AGENT_MAX_REPORT_EVERY_SEC,
      `Report interval must be at most ${AGENT_MAX_REPORT_EVERY_SEC} seconds`,
    ),
  errorRateThreshold: z.coerce
    .number()
    .min(0, 'Error rate threshold cannot be negative')
    .max(100, 'Error rate threshold must be at most 100 %'),
  p95ThresholdMs: emptyToNull(
    z.coerce.number().int().min(1, 'p95 threshold must be at least 1 ms').max(600_000).nullable(),
  ),
  probeUrl: probeUrlSchema,
  externalCheckEverySec: emptyToNull(
    z.coerce
      .number()
      .int()
      .min(
        AGENT_MIN_EXTERNAL_CHECK_SEC,
        `External check must be at most every ${AGENT_MIN_EXTERNAL_CHECK_SEC} seconds`,
      )
      .max(AGENT_MAX_EXTERNAL_CHECK_SEC, 'External check must run at least once a day')
      .nullable(),
  ),
});

/** The external check runs against probeUrl, so it needs one. */
const externalNeedsProbe = (monitor, ctx) => {
  if (monitor.externalCheckEverySec != null && !monitor.probeUrl) {
    ctx.addIssue({
      code: 'custom',
      path: ['probeUrl'],
      message: 'An external check needs a probe URL',
    });
  }
};

// Create: defaults applied; PATCH: partial, re-validated merged with agentCreate.
export const agentCreateSchema = agentFields
  .extend({
    type: z.literal(MONITOR_TYPES.AGENT),
    reportEverySec: agentFields.shape.reportEverySec.default(AGENT_DEFAULT_REPORT_EVERY_SEC),
    errorRateThreshold: agentFields.shape.errorRateThreshold.default(
      AGENT_DEFAULT_ERROR_RATE_THRESHOLD,
    ),
  })
  .superRefine(externalNeedsProbe);

export const agentUpdateSchema = agentFields
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to update');

const msSchema = z
  .number()
  .min(0)
  .max(24 * 60 * 60 * 1000)
  .nullable();
const countSchema = z.number().int().min(0).max(1_000_000_000);

/**
 * Body of POST /agent/report (sent by pulseboard-agent). Unknown keys are
 * dropped so newer agents can add fields without breaking older servers.
 */
export const agentReportSchema = z
  .object({
    windowStart: z.coerce.date(),
    windowEnd: z.coerce.date(),
    requests: countSchema,
    errors5xx: countSchema,
    errors4xx: countSchema,
    p50Ms: msSchema.optional().default(null),
    p95Ms: msSchema.optional().default(null),
    p99Ms: msSchema.optional().default(null),
    topRoutes: z
      .array(
        z.object({
          route: z.string().max(300),
          requests: countSchema,
          errors5xx: countSchema,
          p95Ms: msSchema.optional().default(null),
        }),
      )
      .max(100)
      .default([]),
    agentVersion: z.string().max(50).nullish().default(null),
    hostname: z.string().max(255).nullish().default(null),
    serviceName: z.string().max(100).nullish().default(null),
    uptimeSec: z.number().min(0).nullish().default(null),
  })
  .superRefine((report, ctx) => {
    if (report.windowEnd < report.windowStart) {
      ctx.addIssue({
        code: 'custom',
        path: ['windowEnd'],
        message: 'windowEnd is before windowStart',
      });
    }
    if (report.errors5xx + report.errors4xx > report.requests) {
      ctx.addIssue({ code: 'custom', path: ['errors5xx'], message: 'More errors than requests' });
    }
  });
