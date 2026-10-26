// Constants shared by api, worker and client. Keep this file free of Node-only
// imports: the client bundles it.

export const ROLES = Object.freeze({ OWNER: 'owner', MEMBER: 'member', VIEWER: 'viewer' });

// Higher rank = more permissions. requireRole('member') passes for member and owner.
export const ROLE_RANK = Object.freeze({ viewer: 1, member: 2, owner: 3 });

export const MONITOR_STATUS = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  PENDING: 'pending',
  PAUSED: 'paused',
});

export const HTTP_METHODS = Object.freeze(['GET', 'HEAD', 'POST']);

// Who sends the requests: PulseBoard polls (http), or the customer pushes
// (heartbeat pings, agent reports). Existing monitors are http.
export const MONITOR_TYPES = Object.freeze({
  HTTP: 'http',
  HEARTBEAT: 'heartbeat',
  AGENT: 'agent',
});

// Currencies offered for the cost estimator (the customer's own API price).
export const CURRENCIES = Object.freeze(['INR', 'USD', 'EUR', 'GBP']);
export const DEFAULT_CURRENCY = 'INR';

export const ALERT_CHANNEL_TYPES = Object.freeze(['email', 'discord', 'slack']);

export const INCIDENT_EVENT = Object.freeze({
  OPENED: 'opened',
  ALERT_SENT: 'alert_sent',
  ALERT_FAILED: 'alert_failed',
  RESOLVED: 'resolved',
});

// Incident state machine thresholds.
export const FAILURE_THRESHOLD = 3;
export const RECOVERY_THRESHOLD = 2;

export const MIN_INTERVAL_SEC = 30;
export const MIN_INTERVAL_SEC_DEMO = 10;
export const MAX_INTERVAL_SEC = 24 * 60 * 60;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TIMEOUT_MS = 30_000;
export const DEFAULT_EXPECTED_STATUS = Object.freeze({ min: 200, max: 399 });

// Raw check results are kept for 7 days; older history comes from daily rollups.
export const CHECK_RESULT_TTL_SEC = 7 * 24 * 60 * 60;

export const JOB_NAMES = Object.freeze({
  RUN_CHECK: 'run-check',
  SEND_ALERT: 'send-alert',
  ROLLUP: 'rollup',
  FINALIZE_ROLLUP: 'finalize-rollup',
});

// send-alert retries after a failed delivery: 30s, then 2m, then 8m, then give up.
export const ALERT_RETRY_DELAYS_SEC = Object.freeze([30, 120, 480]);

export const ALERT_KIND = Object.freeze({ DOWN: 'down', UP: 'up', TEST: 'test' });

export const PAGINATION = Object.freeze({ DEFAULT_LIMIT: 20, MAX_LIMIT: 100 });
