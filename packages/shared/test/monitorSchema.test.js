import { describe, expect, it } from 'vitest';
import { buildMonitorSchemas } from '../src/schemas/monitor.js';

const valid = { name: 'API', url: 'https://example.com/health', intervalSec: 60 };

describe('buildMonitorSchemas', () => {
  const { create, update } = buildMonitorSchemas({ demoMode: false });

  it('applies defaults', () => {
    expect(create.parse(valid)).toEqual({
      ...valid,
      method: 'GET',
      timeoutMs: 10_000,
      expectedStatus: { min: 200, max: 399 },
      keyword: null,
    });
  });

  it('enforces a 30s minimum interval normally and 10s in demo mode', () => {
    expect(create.safeParse({ ...valid, intervalSec: 10 }).success).toBe(false);
    const demo = buildMonitorSchemas({ demoMode: true });
    expect(demo.create.safeParse({ ...valid, intervalSec: 10, timeoutMs: 5000 }).success).toBe(
      true,
    );
    expect(demo.create.safeParse({ ...valid, intervalSec: 5 }).success).toBe(false);
  });

  it('requires an http(s) URL', () => {
    expect(create.safeParse({ ...valid, url: 'ftp://example.com' }).success).toBe(false);
    expect(create.safeParse({ ...valid, url: 'example.com' }).success).toBe(false);
  });

  it('rejects an inverted status range', () => {
    const result = create.safeParse({ ...valid, expectedStatus: { min: 400, max: 200 } });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['expectedStatus', 'max']);
  });

  it('rejects a timeout longer than the interval', () => {
    const result = create.safeParse({ ...valid, intervalSec: 30, timeoutMs: 30_001 });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['timeoutMs']);
  });

  it('treats an empty keyword as no keyword', () => {
    expect(create.parse({ ...valid, keyword: '  ' }).keyword).toBeNull();
    expect(create.parse({ ...valid, keyword: ' OK ' }).keyword).toBe('OK');
  });

  it('validates custom headers', () => {
    expect(create.safeParse({ ...valid, headers: { Authorization: 'Bearer x' } }).success).toBe(
      true,
    );
    expect(create.safeParse({ ...valid, headers: { Host: 'evil.com' } }).success).toBe(false);
    expect(create.safeParse({ ...valid, headers: { 'Bad Header': 'x' } }).success).toBe(false);
  });

  it('accepts partial updates without filling in defaults, but not empty ones', () => {
    expect(Object.keys(update.parse({ name: 'Renamed' }))).toEqual(['name']);
    expect(update.safeParse({}).success).toBe(false);
  });
});
