import { describe, expect, it } from 'vitest';
import {
  agentEndpoint,
  agentIntervalLabel,
  agentSnippets,
  agentState,
  buildAgentSchema,
  estimateAgentMonthlyRequests,
  externalCheckOptions,
  isAgent,
  maskedKey,
  metricsSeries,
  metricsSummary,
  reportEveryOptions,
  requestsSavedVsPolling,
  toAgentFormValues,
} from './agent.js';
import { isOperational, STATUS_STYLES, statusStyle } from './status.js';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const ago = (sec) => new Date(NOW - sec * 1000).toISOString();

describe('agent helpers', () => {
  it('detects agent monitors', () => {
    expect(isAgent({ type: 'agent' })).toBe(true);
    expect(isAgent({ type: 'heartbeat' })).toBe(false);
    expect(isAgent(undefined)).toBe(false);
  });

  it('offers presets and keeps the current value', () => {
    expect(reportEveryOptions()).toEqual([30, 60, 120, 300]);
    expect(reportEveryOptions(90)).toEqual([30, 60, 90, 120, 300]);
    expect(externalCheckOptions(null)).toEqual([300, 900, 1800, 3600, 21600, 86400]);
    expect(externalCheckOptions(7200)).toContain(7200);
  });

  it('validates the form like the API contract (defaults, empty = not set)', () => {
    const schema = buildAgentSchema();
    expect(schema.safeParse(toAgentFormValues()).success).toBe(false); // name required
    expect(schema.parse({ ...toAgentFormValues(), name: ' Shop API ' })).toEqual({
      name: 'Shop API',
      reportEverySec: 60,
      errorRateThreshold: 5,
      p95ThresholdMs: null,
      probeUrl: null,
      externalCheckEverySec: null,
    });
  });

  it('rejects what the API rejects', () => {
    const schema = buildAgentSchema();
    const base = { ...toAgentFormValues(), name: 'Shop API' };
    expect(schema.safeParse({ ...base, reportEverySec: '10' }).success).toBe(false);
    expect(schema.safeParse({ ...base, errorRateThreshold: '101' }).success).toBe(false);
    expect(schema.safeParse({ ...base, probeUrl: 'not a url' }).success).toBe(false);
    const noProbe = schema.safeParse({ ...base, externalCheckEverySec: '1800' });
    expect(noProbe.success).toBe(false);
    expect(noProbe.error.issues[0].path).toEqual(['probeUrl']);
    expect(
      schema.parse({
        ...base,
        probeUrl: 'https://shop.example.com/health',
        externalCheckEverySec: '1800',
      }),
    ).toMatchObject({ probeUrl: 'https://shop.example.com/health', externalCheckEverySec: 1800 });
  });

  it('round-trips a saved monitor into form values', () => {
    const values = toAgentFormValues({
      name: 'Shop',
      reportEverySec: 120,
      errorRateThreshold: 2.5,
      p95ThresholdMs: 800,
      probeUrl: null,
      externalCheckEverySec: null,
    });
    expect(values).toEqual({
      name: 'Shop',
      reportEverySec: '120',
      errorRateThreshold: '2.5',
      p95ThresholdMs: '800',
      probeUrl: '',
      externalCheckEverySec: '',
    });
  });

  it('estimates requests to the customer servers and the saving vs 1-minute polling', () => {
    expect(estimateAgentMonthlyRequests(null)).toBe(0);
    expect(estimateAgentMonthlyRequests('')).toBe(0);
    expect(estimateAgentMonthlyRequests(1800)).toBe(1440);
    expect(requestsSavedVsPolling(0)).toBe(43_200);
    expect(requestsSavedVsPolling(1440)).toBe(41_760);
    expect(requestsSavedVsPolling(90_000)).toBe(0);
  });

  it('builds snippets: the key only appears in the env line, never in code', () => {
    const endpoint = agentEndpoint('https://app.example.com');
    expect(endpoint).toBe('https://app.example.com/api/v1');
    const snippets = agentSnippets({ endpoint, reportEverySec: 60, agentKey: 'pbk_secret' });
    expect(snippets.install).toBe('npm install pulseboard-agent');
    expect(snippets.env).toBe('PULSEBOARD_KEY=pbk_secret');
    expect(snippets.code).toContain("endpoint: 'https://app.example.com/api/v1'");
    expect(snippets.code).toContain('process.env.PULSEBOARD_KEY');
    expect(snippets.code).not.toContain('pbk_secret');
    expect(snippets.code).not.toContain('reportEverySec'); // default interval
    expect(agentSnippets({ endpoint, reportEverySec: 120 }).code).toContain('reportEverySec: 120');
    expect(maskedKey('pbk_Ab3d')).toMatch(/^pbk_Ab3d•+$/);
  });

  it('labels the dashboard interval', () => {
    expect(agentIntervalLabel({ reportEverySec: 60 })).toBe('every 1m · agent');
    expect(agentIntervalLabel({})).toBe('every 1m · agent');
  });
});

describe('agentState', () => {
  const monitor = { reportEverySec: 60, probeUrl: 'https://shop.example.com/health' };

  it('waits for the first report, then reports', () => {
    expect(agentState({ ...monitor }, NOW).state).toBe('waiting');
    const reporting = agentState(
      { ...monitor, lastReportAt: ago(30), silenceState: 'reporting' },
      NOW,
    );
    expect(reporting).toEqual({
      state: 'reporting',
      text: 'Reporting: last report 30 seconds ago',
    });
  });

  it('flags a late report before the detector notices', () => {
    expect(
      agentState({ ...monitor, lastReportAt: ago(150), silenceState: 'reporting' }, NOW).state,
    ).toBe('late');
  });

  it('describes probing, silent and degraded in words', () => {
    expect(
      agentState({ ...monitor, lastReportAt: ago(130), silenceState: 'probing' }, NOW),
    ).toEqual({
      state: 'probing',
      text: 'No report (last report 2 minutes ago): checking shop.example.com…',
    });
    expect(agentState({ ...monitor, silenceState: 'silent', status: 'down' }, NOW).text).toBe(
      'Agent silent: no report yet',
    );
    expect(
      agentState(
        { ...monitor, lastReportAt: ago(600), silenceState: 'silent', status: 'degraded' },
        NOW,
      ),
    ).toEqual({
      state: 'degraded',
      text: 'Agent stopped reporting (last report 10 minutes ago), but shop.example.com still answers',
    });
  });

  it('paused wins', () => {
    expect(agentState({ ...monitor, isPaused: true, silenceState: 'silent' }, NOW).state).toBe(
      'paused',
    );
  });
});

describe('metricsSeries', () => {
  const t = (min) => new Date(NOW + min * 60_000).toISOString();

  it('computes per-minute rate and error rate (5xx / requests, %)', () => {
    const rows = metricsSeries(
      [
        { t: t(0), requests: 120, errors5xx: 6, errors4xx: 2, p50Ms: 10, p95Ms: 80, p99Ms: 200 },
        { t: t(2), requests: 60, errors5xx: 0, errors4xx: 0, p50Ms: 9, p95Ms: 70, p99Ms: 150 },
        { t: t(4), requests: 0, errors5xx: 0, errors4xx: 0, p50Ms: null, p95Ms: null, p99Ms: null },
      ],
      60,
    );
    // Points are 2 minutes apart (e.g. reportEverySec 120 or downsampled buckets).
    expect(rows.map((r) => r.perMinute)).toEqual([60, 30, 0]);
    expect(rows.map((r) => r.errorRate)).toEqual([5, 0, null]);
    expect(rows[2].p95Ms).toBeNull();
    expect(metricsSummary(rows)).toEqual({ requests: 180, errors5xx: 6, errorRate: 3.3 });
  });

  it('falls back to the report interval with a single point', () => {
    expect(metricsSeries([{ t: t(0), requests: 30, errors5xx: 0 }], 30)[0].perMinute).toBe(60);
    expect(metricsSeries([], 60)).toEqual([]);
    expect(metricsSummary([])).toEqual({ requests: 0, errors5xx: 0, errorRate: null });
  });
});

describe('degraded status styling', () => {
  it('is amber with its own "Degraded" text label', () => {
    expect(statusStyle('degraded')).toBe(STATUS_STYLES.degraded);
    expect(STATUS_STYLES.degraded).toMatchObject({ label: 'Degraded', tone: 'amber' });
    expect(STATUS_STYLES.degraded.text).toMatch(/amber/);
  });

  it('counts as up in summaries (the app is reachable)', () => {
    expect(isOperational('degraded')).toBe(true);
    expect(isOperational('up')).toBe(true);
    expect(['down', 'pending', 'paused', undefined].some(isOperational)).toBe(false);
  });
});
