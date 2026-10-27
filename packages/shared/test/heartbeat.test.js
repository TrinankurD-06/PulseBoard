import { describe, expect, it } from 'vitest';
import { buildAlert, discordPayload } from '../src/alerts/index.js';
import {
  decideTransition,
  nextMonitorState,
  thresholdsFor,
  TRANSITION_GUARDS,
  transitionGuards,
  TRANSITIONS,
} from '../src/incident/stateMachine.js';
import { buildMonitorSchemas, monitorTypeSchema } from '../src/schemas/monitor.js';

const fresh = (type, status = 'pending') => ({
  type,
  status,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
});

/** Feeds "✓✗..." through the machine for a monitor type; returns transitions + final state. */
function run(type, sequence, start = fresh(type)) {
  let state = start;
  const transitions = [];
  for (const symbol of sequence) {
    state = { ...nextMonitorState(state, symbol === '✓'), type };
    if (state.transition) transitions.push(state.transition);
  }
  return { status: state.status, transitions };
}

describe('incident thresholds per monitor type', () => {
  it('http (and missing type) keep 3 failures / 2 successes; heartbeat uses 1 / 1', () => {
    expect(thresholdsFor('http')).toEqual({ failure: 3, recovery: 2 });
    expect(thresholdsFor(undefined)).toEqual({ failure: 3, recovery: 2 });
    expect(thresholdsFor('agent')).toEqual({ failure: 3, recovery: 2 });
    expect(thresholdsFor('heartbeat')).toEqual({ failure: 1, recovery: 1 });
  });

  it('http behaviour is unchanged: a single failure opens nothing', () => {
    expect(run('http', '✓✗✗')).toMatchObject({ status: 'up', transitions: ['mark_up'] });
    expect(run('http', '✓✗✗✗').transitions).toEqual(['mark_up', 'open_incident']);
  });

  it('heartbeat: one missed/failed ping opens an incident, one ping resolves it', () => {
    expect(run('heartbeat', '✓✗').transitions).toEqual(['mark_up', 'open_incident']);
    expect(run('heartbeat', '✓✗✓')).toMatchObject({
      status: 'up',
      transitions: ['mark_up', 'open_incident', 'resolve_incident'],
    });
    // A heartbeat that never pinged goes straight from pending to down.
    expect(run('heartbeat', '✗').transitions).toEqual(['open_incident']);
  });

  it('heartbeat stays down through more missed periods (one incident)', () => {
    expect(run('heartbeat', '✗✗✗✗').transitions).toEqual(['open_incident']);
  });

  it('decideTransition reads the type from the state, or takes explicit thresholds', () => {
    const counted = { status: 'up', consecutiveFailures: 1, consecutiveSuccesses: 0 };
    expect(decideTransition(counted)).toBeNull();
    expect(decideTransition({ ...counted, type: 'heartbeat' })).toBe(TRANSITIONS.OPEN_INCIDENT);
    expect(decideTransition(counted, { failure: 1, recovery: 1 })).toBe(TRANSITIONS.OPEN_INCIDENT);
  });

  it('guards repeat the thresholds of the type (http guards unchanged)', () => {
    expect(TRANSITION_GUARDS.open_incident.consecutiveFailures).toEqual({ $gte: 3 });
    const heartbeat = transitionGuards(thresholdsFor('heartbeat'));
    expect(heartbeat.open_incident.consecutiveFailures).toEqual({ $gte: 1 });
    expect(heartbeat.resolve_incident.consecutiveSuccesses).toEqual({ $gte: 1 });
  });
});

describe('heartbeat schemas', () => {
  const schemas = buildMonitorSchemas({ demoMode: false });

  it('creates with a default 60 s grace period and no URL', () => {
    expect(
      schemas.heartbeatCreate.parse({
        type: 'heartbeat',
        name: 'Nightly backup',
        expectedEverySec: 86_400,
      }),
    ).toEqual({
      type: 'heartbeat',
      name: 'Nightly backup',
      expectedEverySec: 86_400,
      graceSec: 60,
    });
  });

  it('validates the expected interval (mode minimum to 30 days) and grace (0 to 1 day)', () => {
    const base = { type: 'heartbeat', name: 'Job' };
    const parse = (extra) => schemas.heartbeatCreate.safeParse({ ...base, ...extra }).success;
    expect(parse({ expectedEverySec: 10 })).toBe(false); // < 30 s outside demo mode
    expect(parse({ expectedEverySec: 30 })).toBe(true);
    expect(parse({ expectedEverySec: 31 * 86_400 })).toBe(false);
    expect(parse({ expectedEverySec: 60, graceSec: 0 })).toBe(true);
    expect(parse({ expectedEverySec: 60, graceSec: -1 })).toBe(false);
    expect(parse({ expectedEverySec: 60, graceSec: 86_401 })).toBe(false);
    const demo = buildMonitorSchemas({ demoMode: true });
    expect(demo.heartbeatCreate.safeParse({ ...base, expectedEverySec: 10 }).success).toBe(true);
  });

  it('partial updates keep only the given fields; empty updates are rejected', () => {
    expect(schemas.heartbeatUpdate.parse({ graceSec: 300 })).toEqual({ graceSec: 300 });
    expect(schemas.heartbeatUpdate.safeParse({}).success).toBe(false);
  });

  it('the type defaults to http; http, heartbeat and agent (U4) are accepted', () => {
    expect(monitorTypeSchema.parse(undefined)).toBe('http');
    expect(monitorTypeSchema.parse('heartbeat')).toBe('heartbeat');
    expect(monitorTypeSchema.parse('agent')).toBe('agent');
    expect(monitorTypeSchema.safeParse('ftp').success).toBe(false);
  });
});

describe('heartbeat alerts', () => {
  const monitor = {
    _id: 'm1',
    workspaceId: 'w1',
    name: 'Nightly backup',
    type: 'heartbeat',
    lastPingAt: new Date('2026-10-20T02:00:00Z'),
  };
  const incident = {
    cause: 'No ping received within 1d + 1m grace',
    startedAt: new Date(),
    durationSec: 120,
  };
  const dashboardUrl = 'https://app.example.com';

  it('talks about pings, not a URL', () => {
    const down = buildAlert({ kind: 'down', monitor, incident, dashboardUrl });
    expect(down.summary).toBe(
      `No ping from Nightly backup since ${monitor.lastPingAt.toUTCString()}.`,
    );
    const up = buildAlert({ kind: 'up', monitor, incident, dashboardUrl });
    expect(up.summary).toBe('Nightly backup is sending pings again.');
  });

  it('a heartbeat that never pinged says so', () => {
    const down = buildAlert({
      kind: 'down',
      monitor: { ...monitor, lastPingAt: null },
      incident,
      dashboardUrl,
    });
    expect(down.summary).toBe('No ping from Nightly backup since it was created.');
  });

  it('the Discord embed has no empty URL field', () => {
    const embed = discordPayload(buildAlert({ kind: 'down', monitor, incident, dashboardUrl }))
      .embeds[0];
    expect(embed.fields.map((field) => field.name)).not.toContain('URL');
  });
});
