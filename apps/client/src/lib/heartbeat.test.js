import { describe, expect, it } from 'vitest';
import {
  buildHeartbeatSchema,
  cronFor,
  expectedEveryOptions,
  graceOptions,
  heartbeatIntervalLabel,
  heartbeatSnippets,
  heartbeatState,
  isHeartbeat,
  pingHistory,
  pingUrl,
} from './heartbeat.js';

const URL = 'https://app.example.com/api/v1/ping/abc123';

describe('heartbeat helpers', () => {
  it('detects heartbeat monitors', () => {
    expect(isHeartbeat({ type: 'heartbeat' })).toBe(true);
    expect(isHeartbeat({ type: 'http' })).toBe(false);
    expect(isHeartbeat(undefined)).toBe(false);
  });

  it('builds the ping URL from the app origin', () => {
    expect(pingUrl('abc123', 'https://app.example.com')).toBe(URL);
  });

  it('offers presets above the server minimum and keeps the current value', () => {
    expect(expectedEveryOptions(30)).toEqual([30, 60, 300, 900, 3600, 21600, 86400, 604800]);
    expect(expectedEveryOptions(10)[0]).toBe(10);
    expect(expectedEveryOptions(30, 7200)).toContain(7200);
    expect(graceOptions()).toEqual([0, 60, 300, 900, 3600]);
    expect(graceOptions(120)).toEqual([0, 60, 120, 300, 900, 3600]);
  });

  it('validates the form like the API contract', () => {
    const schema = buildHeartbeatSchema(30);
    expect(schema.parse({ name: ' Backup ', expectedEverySec: '3600', graceSec: '60' })).toEqual({
      name: 'Backup',
      expectedEverySec: 3600,
      graceSec: 60,
    });
    expect(schema.safeParse({ name: '', expectedEverySec: 10, graceSec: -1 }).success).toBe(false);
    expect(schema.safeParse({ name: 'x', expectedEverySec: 31 * 86400, graceSec: 0 }).success).toBe(
      false,
    );
  });

  it('turns the interval into a matching cron schedule', () => {
    expect(cronFor(60)).toBe('* * * * *');
    expect(cronFor(300)).toBe('*/5 * * * *');
    expect(cronFor(3600)).toBe('0 * * * *');
    expect(cronFor(6 * 3600)).toBe('0 */6 * * *');
    expect(cronFor(86400)).toBe('0 0 * * *');
    expect(cronFor(7 * 86400)).toBe('0 0 * * 0');
    expect(cronFor(10)).toBe('*/5 * * * *'); // cron can't do seconds: fallback
    expect(cronFor(420)).toBe('*/5 * * * *'); // 7 min doesn't divide an hour
  });

  it('builds copy-paste snippets that use the URL, /start and /fail', () => {
    const snippets = heartbeatSnippets(URL, 300);
    expect(snippets.curl).toBe(`curl -fsS -m 10 --retry 3 ${URL}`);
    expect(snippets.cron).toMatch(/^\*\/5 \* \* \* \* {2}\/path\/to\/your-job\.sh && curl/);
    expect(snippets.node).toContain(`fetch('${URL}'`);
    expect(snippets.startFail).toContain('/start');
    expect(snippets.startFail).toContain('/fail');
    expect(snippets.startFail).toContain(`const PING = '${URL}';`);
  });

  it('labels the interval for dashboard cards', () => {
    expect(heartbeatIntervalLabel({ expectedEverySec: 3600 })).toBe('every 1h · heartbeat');
  });

  it('describes the current state in words', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    const later = '2026-01-01T12:30:00Z';
    const earlier = '2026-01-01T11:30:00Z';
    expect(heartbeatState({ isPaused: true }, now).state).toBe('paused');
    expect(heartbeatState({ lastPingAt: null, nextDueAt: later }, now).state).toBe('waiting');
    expect(heartbeatState({ lastPingAt: null, nextDueAt: earlier }, now).state).toBe('overdue');
    expect(heartbeatState({ lastPingAt: earlier, nextDueAt: later }, now)).toMatchObject({
      state: 'ok',
    });
    expect(heartbeatState({ lastPingAt: earlier, nextDueAt: earlier }, now).text).toMatch(
      /^Overdue since/,
    );
  });

  it('summarises ping history with run durations', () => {
    const history = pingHistory([
      { t: '2026-01-01T10:00:00Z', ok: true, totalMs: 1000 },
      { t: '2026-01-01T11:00:00Z', ok: false, totalMs: null },
      { t: '2026-01-01T12:00:00Z', ok: true, totalMs: 3000 },
      { t: '2026-01-01T13:00:00Z', ok: true, totalMs: null },
    ]);
    expect(history).toMatchObject({ received: 3, missed: 1, avgDurationMs: 2000 });
    expect(history.entries[1]).toMatchObject({ ok: false, label: 'Missed or failed' });
    expect(pingHistory([]).avgDurationMs).toBeNull();
  });
});
