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
  // Agent monitors (U4): the agent stopped reporting but the endpoint still
  // answers. Not an incident; public status pages show it as operational.
  DEGRADED: 'degraded',
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

// Incident state machine thresholds (http and agent monitors).
export const FAILURE_THRESHOLD = 3;
export const RECOVERY_THRESHOLD = 2;

// Heartbeat monitors confirm with 1/1: the grace period already is the
// confirmation, and a daily job can't wait 3 days to be reported missing.
export const HEARTBEAT_FAILURE_THRESHOLD = 1;
export const HEARTBEAT_RECOVERY_THRESHOLD = 1;

// Heartbeat monitors (U3): the customer's job pings us; we send no requests.
export const HEARTBEAT_DEFAULT_GRACE_SEC = 60;
export const HEARTBEAT_MAX_GRACE_SEC = 24 * 60 * 60;
export const HEARTBEAT_MAX_EXPECTED_SEC = 30 * 24 * 60 * 60;
// Max missed periods the overdue detector records per monitor per run (it
// catches up on the next runs), so one long-dead minutely job can't stall it.
export const HEARTBEAT_MAX_MISSED_PER_RUN = 50;

// Agent monitors (U4): the customer's app reports aggregated metrics to us.
export const AGENT_DEFAULT_REPORT_EVERY_SEC = 60;
export const AGENT_MIN_REPORT_EVERY_SEC = 30;
export const AGENT_MAX_REPORT_EVERY_SEC = 300;
export const AGENT_DEFAULT_ERROR_RATE_THRESHOLD = 5;
export const AGENT_MIN_EXTERNAL_CHECK_SEC = 300;
export const AGENT_MAX_EXTERNAL_CHECK_SEC = 24 * 60 * 60;
// Silence = no report for this many report periods.
export const AGENT_SILENCE_PERIODS = 2;
// Probe-on-silence: up to this many HEAD probes, this far apart.
export const AGENT_PROBE_COUNT = 3;
export const AGENT_PROBE_SPACING_MS = 10_000;
// While silent but reachable (degraded), probe again this often.
export const AGENT_REPROBE_EVERY_SEC = 300;
// Reports accepted per key per minute.
export const AGENT_REPORT_RATE_LIMIT = 30;
export const AGENT_KEY_PREFIX = 'pbk_';
export const AGENT_SILENCE_STATE = Object.freeze({
  REPORTING: 'reporting',
  PROBING: 'probing',
  SILENT: 'silent',
});
// Baseline for "requests saved": polling every minute for 30 days.
export const POLLING_BASELINE_MONTHLY_REQUESTS = 43_200;

// Where a check result came from (CheckResult.source; missing = 'http').
export const CHECK_SOURCES = Object.freeze({
  HTTP: 'http',
  HEARTBEAT: 'heartbeat',
  AGENT: 'agent',
  PROBE: 'probe',
  EXTERNAL: 'external',
});

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
  SEND_NOTICE: 'send-notice',
  BUDGET_RESET: 'budget-reset',
  HEARTBEAT_OVERDUE: 'heartbeat-overdue',
  AGENT_SILENCE: 'agent-silence',
});

// Adaptive intervals (U2): each run of this many consecutive successes while up
// doubles the interval, up to maxIntervalSec.
export const ADAPTIVE_SUCCESS_RUN = 10;
export const ADAPTIVE_DEFAULT_MAX_INTERVAL_SEC = 600;

// Monthly request budgets (U2).
export const BUDGET_ACTIONS = Object.freeze(['slow', 'pause']);
export const BUDGET_WARNING_RATIO = 0.8;
export const BUDGET_SLOW_INTERVAL_SEC = 900;
export const PAUSED_REASONS = Object.freeze({ USER: 'user', BUDGET: 'budget_exceeded' });

// Alerts that aren't about an incident (sent by the send-notice job).
export const NOTICE_KIND = Object.freeze({
  BUDGET_WARNING: 'budget_warning',
  BUDGET_EXCEEDED: 'budget_exceeded',
  AGENT_SILENT: 'agent_silent',
});

// send-alert retries after a failed delivery: 30s, then 2m, then 8m, then give up.
export const ALERT_RETRY_DELAYS_SEC = Object.freeze([30, 120, 480]);

export const ALERT_KIND = Object.freeze({ DOWN: 'down', UP: 'up', TEST: 'test', NOTICE: 'notice' });

export const PAGINATION = Object.freeze({ DEFAULT_LIMIT: 20, MAX_LIMIT: 100 });

// Sign-in providers the API knows how to talk to. Each is enabled only when its
// client id and secret are configured (see GET /auth/oauth/providers).
export const OAUTH_PROVIDERS = Object.freeze(['google', 'github']);
