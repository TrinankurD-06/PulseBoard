import { describe, expect, it } from 'vitest';
import {
  errorRateOf,
  evaluateAgentReport,
  probeTargetOf,
  silentSinceOf,
} from '../src/agent/index.js';
import { buildAlert } from '../src/alerts/message.js';
import { buildNotice } from '../src/alerts/notice.js';
import { MONITOR_STATUS, NOTICE_KIND } from '../src/constants.js';
import {
  estimateMonthlyRequests,
  estimateRequestsBetween,
  estimateRequestsSaved,
} from '../src/cost/index.js';
import { thresholdsFor } from '../src/incident/stateMachine.js';
import {
  CHECK_JOB_MONITOR_FILTER,
  needsCheckJob,
  repeatSecondsOf,
} from '../src/scheduling/agenda.js';
import { agentCreateSchema, agentReportSchema, agentUpdateSchema } from '../src/schemas/index.js';
import { overallStatus, publicMonitorStatus } from '../src/statusPage.js';

const monitor = { errorRateThreshold: 5, p95ThresholdMs: null };
const report = (overrides = {}) => ({
  requests: 1000,
  errors5xx: 3,
  errors4xx: 17,
  p50Ms: 12,
  p95Ms: 88,
  p99Ms: 240,
  ...overrides,
});

describe('evaluateAgentReport', () => {
  it('passes a healthy report', () => {
    expect(evaluateAgentReport(report(), monitor)).toEqual({ ok: true, error: null });
  });

  it('fails when the 5xx error rate is above the threshold, with a readable cause', () => {
    expect(evaluateAgentReport(report({ errors5xx: 82 }), monitor)).toEqual({
      ok: false,
      error: 'Error rate 8.2 % above 5 %',
    });
  });

  it('a rate exactly at the threshold still passes; 4xx never counts', () => {
    expect(evaluateAgentReport(report({ errors5xx: 50 }), monitor).ok).toBe(true);
    expect(evaluateAgentReport(report({ errors5xx: 0, errors4xx: 900 }), monitor).ok).toBe(true);
  });

  it('zero traffic is a success: the report proves the app is alive', () => {
    const empty = report({ requests: 0, errors5xx: 0, errors4xx: 0, p50Ms: null, p95Ms: null });
    expect(evaluateAgentReport(empty, { ...monitor, p95ThresholdMs: 10 }).ok).toBe(true);
    expect(errorRateOf(empty)).toBeNull();
  });

  it('fails a p95 above p95ThresholdMs, only when one is set', () => {
    expect(evaluateAgentReport(report({ p95Ms: 412.34 }), monitor).ok).toBe(true);
    expect(
      evaluateAgentReport(report({ p95Ms: 412.34 }), { ...monitor, p95ThresholdMs: 300 }),
    ).toEqual({
      ok: false,
      error: 'p95 412.3 ms above 300 ms',
    });
  });

  it('reports both breaches together, and defaults the threshold to 5 %', () => {
    const result = evaluateAgentReport(report({ errors5xx: 100, p95Ms: 900 }), {
      p95ThresholdMs: 500,
    });
    expect(result).toEqual({
      ok: false,
      error: 'Error rate 10 % above 5 %; p95 900 ms above 500 ms',
    });
  });

  it('agent monitors confirm with 3 failures / 2 successes like http', () => {
    expect(thresholdsFor('agent')).toEqual({ failure: 3, recovery: 2 });
  });
});

describe('agent helpers', () => {
  it('silence counts from the later of last report and watch start (else creation)', () => {
    const createdAt = new Date('2026-10-01T00:00:00Z');
    const watchSince = new Date('2026-10-20T00:00:00Z');
    const lastReportAt = new Date('2026-10-10T00:00:00Z');
    expect(silentSinceOf({ createdAt })).toEqual(createdAt);
    expect(silentSinceOf({ createdAt, lastReportAt })).toEqual(lastReportAt);
    expect(silentSinceOf({ createdAt, lastReportAt, watchSince })).toEqual(watchSince);
  });

  it('probes are cheap HEAD requests to probeUrl with default expectations', () => {
    expect(probeTargetOf({ probeUrl: 'https://shop.example.com/health' })).toEqual({
      url: 'https://shop.example.com/health',
      method: 'HEAD',
      timeoutMs: 10_000,
      expectedStatus: { min: 200, max: 399 },
      keyword: null,
      headUnsupported: false,
    });
  });
});

describe('agent schemas', () => {
  it('create applies defaults and normalises empty optional fields', () => {
    expect(
      agentCreateSchema.parse({
        type: 'agent',
        name: ' Shop ',
        probeUrl: '',
        p95ThresholdMs: '',
        externalCheckEverySec: '',
      }),
    ).toEqual({
      type: 'agent',
      name: 'Shop',
      reportEverySec: 60,
      errorRateThreshold: 5,
      probeUrl: null,
      p95ThresholdMs: null,
      externalCheckEverySec: null,
    });
  });

  it('enforces the bounds and requires a probe URL for the external check', () => {
    const base = { type: 'agent', name: 'Shop' };
    expect(agentCreateSchema.safeParse({ ...base, reportEverySec: 29 }).success).toBe(false);
    expect(agentCreateSchema.safeParse({ ...base, reportEverySec: 301 }).success).toBe(false);
    expect(agentCreateSchema.safeParse({ ...base, errorRateThreshold: -1 }).success).toBe(false);
    expect(agentCreateSchema.safeParse({ ...base, probeUrl: 'ftp://x.example' }).success).toBe(
      false,
    );
    const external = { ...base, probeUrl: 'https://shop.example.com', externalCheckEverySec: 299 };
    expect(agentCreateSchema.safeParse(external).success).toBe(false);
    expect(
      agentCreateSchema.safeParse({ ...external, externalCheckEverySec: 86_401 }).success,
    ).toBe(false);
    expect(agentCreateSchema.safeParse({ ...external, externalCheckEverySec: 900 }).success).toBe(
      true,
    );
    const missing = agentCreateSchema.safeParse({ ...base, externalCheckEverySec: 900 });
    expect(missing.error.issues[0]).toMatchObject({ path: ['probeUrl'] });
  });

  it('updates are partial without defaults, and not empty', () => {
    expect(agentUpdateSchema.parse({ name: 'New' })).toEqual({ name: 'New' });
    expect(agentUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('accepts the report the SDK sends, zero traffic included, and drops unknown keys', () => {
    const body = {
      windowStart: '2026-10-27T03:00:00.000Z',
      windowEnd: '2026-10-27T03:01:00.000Z',
      requests: 0,
      errors5xx: 0,
      errors4xx: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      topRoutes: [],
      agentVersion: '1.0.0',
      hostname: 'web-1',
      uptimeSec: 86400,
      somethingNew: true,
    };
    const parsed = agentReportSchema.parse(body);
    expect(parsed.windowEnd).toEqual(new Date('2026-10-27T03:01:00.000Z'));
    expect(parsed).not.toHaveProperty('somethingNew');
    expect(
      agentReportSchema.parse({ ...body, p50Ms: undefined, hostname: undefined }),
    ).toMatchObject({
      p50Ms: null,
      hostname: null,
    });
  });

  it('rejects inconsistent or malformed reports', () => {
    const ok = {
      windowStart: '2026-10-27T03:00:00.000Z',
      windowEnd: '2026-10-27T03:01:00.000Z',
      requests: 10,
      errors5xx: 1,
      errors4xx: 1,
    };
    expect(agentReportSchema.safeParse(ok).success).toBe(true);
    expect(agentReportSchema.safeParse({ ...ok, requests: -1 }).success).toBe(false);
    expect(agentReportSchema.safeParse({ ...ok, requests: 1.5 }).success).toBe(false);
    expect(agentReportSchema.safeParse({ ...ok, errors5xx: 10 }).success).toBe(false);
    expect(
      agentReportSchema.safeParse({ ...ok, windowEnd: '2026-10-27T02:00:00.000Z' }).success,
    ).toBe(false);
    expect(agentReportSchema.safeParse({ ...ok, windowStart: 'yesterday' }).success).toBe(false);
    const routes = Array.from({ length: 101 }, (_, i) => ({
      route: `/r${i}`,
      requests: 0,
      errors5xx: 0,
    }));
    expect(agentReportSchema.safeParse({ ...ok, topRoutes: routes }).success).toBe(false);
  });
});

describe('agent cost and scheduling', () => {
  const agent = { type: 'agent', probeUrl: 'https://shop.example.com/health' };

  it('an agent sends nothing unless its external check is on', () => {
    expect(estimateMonthlyRequests(agent)).toBe(0);
    expect(estimateMonthlyRequests({ ...agent, externalCheckEverySec: 900 })).toBe(2880);
    expect(estimateMonthlyRequests({ type: 'agent', externalCheckEverySec: 900 })).toBe(0);
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-10-01T01:00:00Z');
    expect(estimateRequestsBetween({ ...agent, externalCheckEverySec: 1800 }, from, to)).toBe(2);
  });

  it('requests saved = 43,200 (1-minute polling) minus the estimate, never negative', () => {
    expect(estimateRequestsSaved(agent)).toBe(43_200);
    expect(estimateRequestsSaved({ ...agent, externalCheckEverySec: 900 })).toBe(40_320);
    expect(estimateRequestsSaved({ type: 'heartbeat' })).toBe(43_200);
    expect(estimateRequestsSaved({ type: 'http', intervalSec: 300 })).toBe(34_560);
    expect(estimateRequestsSaved({ intervalSec: 60 })).toBe(0);
    expect(estimateRequestsSaved({ type: 'http', intervalSec: 10 })).toBe(0);
  });

  it('only agents with an external check (and a probe URL) get a check job', () => {
    expect(needsCheckJob(agent)).toBe(false);
    expect(needsCheckJob({ ...agent, externalCheckEverySec: 900 })).toBe(true);
    expect(needsCheckJob({ type: 'agent', externalCheckEverySec: 900 })).toBe(false);
    expect(needsCheckJob({ type: 'heartbeat' })).toBe(false);
    expect(needsCheckJob({})).toBe(true);
    expect(repeatSecondsOf({ ...agent, externalCheckEverySec: 900, intervalSec: 60 })).toBe(900);
    expect(repeatSecondsOf({ intervalSec: 60, currentIntervalSec: 120 })).toBe(120);
    expect(CHECK_JOB_MONITOR_FILTER.$or).toHaveLength(2);
  });
});

describe('degraded status and agent alerts', () => {
  it('degraded is operational on public pages', () => {
    expect(overallStatus(['up', 'degraded'])).toBe('operational');
    expect(overallStatus(['down', 'degraded'])).toBe('partial_outage');
    expect(publicMonitorStatus(MONITOR_STATUS.DEGRADED)).toBe('up');
    expect(publicMonitorStatus('down')).toBe('down');
  });

  const shop = {
    _id: 'm1',
    workspaceId: 'w1',
    type: 'agent',
    name: 'Shop API',
    probeUrl: 'https://shop.example.com/health',
  };

  it('agent_silent notice names the reachable host', () => {
    const notice = buildNotice({
      noticeKind: NOTICE_KIND.AGENT_SILENT,
      monitor: shop,
      details: { silentSec: 130 },
      dashboardUrl: 'https://pb.example.com/',
    });
    expect(notice).toMatchObject({
      kind: 'notice',
      title: '⚠️ Shop API: agent stopped reporting, but shop.example.com still answers',
      url: 'https://shop.example.com/health',
      link: 'https://pb.example.com/app/w1/monitors/m1',
    });
    expect(notice.summary).toContain('no report for 130 s');
  });

  it('down / recovered alerts for agents talk about reports, never "undefined"', () => {
    const incident = {
      cause: 'Error rate 8.2 % above 5 %',
      startedAt: new Date(),
      durationSec: 60,
    };
    const down = buildAlert({ kind: 'down', monitor: shop, incident, dashboardUrl: 'https://x' });
    const up = buildAlert({ kind: 'up', monitor: shop, incident, dashboardUrl: 'https://x' });
    expect(down.summary).toContain('agent reports');
    expect(up.summary).toContain('reporting healthy metrics');
    expect(JSON.stringify([down, up])).not.toContain('undefined');
  });
});
