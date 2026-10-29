import type { IncomingMessage, ServerResponse } from 'node:http';

/** Minimal logger: only `warn` (problems) and, with `debug: true`, `info` are used. */
export interface PulseboardLogger {
  warn?(message: string): void;
  info?(message: string): void;
}

export interface PulseboardOptions {
  /** The agent key from your PulseBoard monitor. Required unless `enabled` is `false`. */
  apiKey?: string;
  /** Your PulseBoard API base URL, e.g. `https://your-pulseboard.example.com/api/v1`. Required unless `enabled` is `false`. */
  endpoint?: string;
  /** Seconds between reports, clamped to 30–300. Default `60`. Match the monitor's setting. */
  intervalSec?: number;
  /** Alias of `intervalSec`. */
  reportEverySec?: number;
  /** A label for this service, sent with every report (max 100 characters). */
  serviceName?: string;
  /** Log one line per report to `logger.info`. Default `false`. */
  debug?: boolean;
  /** `false` turns the agent into a silent pass-through (development, tests). Default `true`. */
  enabled?: boolean;
  /** Receives warnings (and `info` lines with `debug`). Default `console`. */
  logger?: PulseboardLogger;
  /** Distinct routes tracked per window; more are counted under `other`. Default `50`. */
  maxRoutes?: number;
  /** Latency samples kept per window (reservoir sampling). Default `5000`. */
  maxSamples?: number;
  /** Flush the last window on `SIGTERM` and `beforeExit`. Default `true`. */
  handleSignals?: boolean;
}

/** The Express (or Connect-style) middleware returned by {@link pulseboard}. Typed structurally, so it needs no @types/express. */
export interface PulseboardMiddleware {
  (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void;
  /** Sends the current window now. Resolves `true` on success, `false` otherwise; never rejects. */
  flush(): Promise<boolean>;
  /** Stops the timer and the process handlers; by default sends the last window first. */
  stop(options?: { flush?: boolean }): Promise<void>;
}

export interface HeartbeatOptions {
  /** A label for this job or function, sent with the report (max 100 characters). */
  serviceName?: string;
  /** Request timeout in milliseconds. Default `5000`. */
  timeoutMs?: number;
}

/** What one report contains, as sent to `POST <endpoint>/agent/report`. */
export interface PulseboardReport {
  windowStart: string;
  windowEnd: string;
  requests: number;
  errors5xx: number;
  errors4xx: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  topRoutes: Array<{ route: string; requests: number; errors5xx: number; p95Ms: number | null }>;
  agentVersion: string;
  hostname: string;
  uptimeSec: number;
  serviceName?: string;
}

/**
 * Express middleware that measures every request and sends one aggregated
 * report per window to PulseBoard. Throws a `TypeError` at start-up if the
 * options are invalid (for example a missing `apiKey`).
 */
export function pulseboard(options?: PulseboardOptions): PulseboardMiddleware;
export default pulseboard;

/**
 * Sends one empty report ("alive, no traffic") from a cron job or serverless
 * function. Throws a `TypeError` for a missing or malformed `apiKey` or
 * `endpoint`; otherwise resolves `true` if PulseBoard accepted it, `false` if
 * not. Never rejects.
 */
export function heartbeat(
  apiKey: string,
  endpoint: string,
  options?: HeartbeatOptions,
): Promise<boolean>;

export const AGENT_VERSION: string;
export const MIN_REPORT_SEC: number;
export const MAX_REPORT_SEC: number;

/** Nearest-rank percentile of an ascending-sorted array (`p` in 0–100); `null` if empty. */
export function percentile(sorted: number[], p: number): number | null;
