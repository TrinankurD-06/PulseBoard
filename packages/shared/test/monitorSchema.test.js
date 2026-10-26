import { describe, expect, it } from 'vitest';
import { buildMonitorSchemas } from '../src/schemas/monitor.js';

const valid = { name: 'API', url: 'https://example.com/health', intervalSec: 60 };

describe('buildMonitorSchemas', () => {
  const { create, update } = buildMonitorSchemas({ demoMode: false });

  it('applies defaults: HEAD (no body needed), INR, no price, adaptive, no budget', () => {
    expect(create.parse(valid)).toEqual({
      ...valid,
      method: 'HEAD',
      timeoutMs: 10_000,
      expectedStatus: { min: 200, max: 399 },
      keyword: null,
      costPer1kRequests: null,
      currency: 'INR',
      adaptive: true,
      minIntervalSec: 30,
      maxIntervalSec: 600,
      monthlyRequestBudget: null,
      budgetAction: 'slow',
    });
  });

  it('defaults to GET when a keyword has to be found in the body', () => {
    expect(create.parse({ ...valid, keyword: 'ok' }).method).toBe('GET');
  });

  it('keeps an explicitly chosen method', () => {
    expect(create.parse({ ...valid, method: 'GET' }).method).toBe('GET');
    expect(create.parse({ ...valid, method: 'POST', keyword: 'ok' }).method).toBe('POST');
  });

  it('rejects HEAD together with a keyword (HEAD responses have no body)', () => {
    const result = create.safeParse({ ...valid, method: 'HEAD', keyword: 'ok' });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['method']);
  });

  it('validates the price per 1,000 requests and the currency', () => {
    expect(create.parse({ ...valid, costPer1kRequests: '2.5', currency: 'USD' })).toMatchObject({
      costPer1kRequests: 2.5,
      currency: 'USD',
    });
    expect(create.parse({ ...valid, costPer1kRequests: '' }).costPer1kRequests).toBeNull();
    expect(create.parse({ ...valid, costPer1kRequests: 0 }).costPer1kRequests).toBe(0);
    expect(create.safeParse({ ...valid, costPer1kRequests: -1 }).success).toBe(false);
    expect(create.safeParse({ ...valid, currency: 'JPY' }).success).toBe(false);
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

  describe('adaptive intervals and budget (U2)', () => {
    it('widens the default bounds so the base interval always fits', () => {
      expect(create.parse({ ...valid, intervalSec: 3600 })).toMatchObject({
        minIntervalSec: 30,
        maxIntervalSec: 3600,
      });
      const demo = buildMonitorSchemas({ demoMode: true });
      expect(demo.create.parse({ ...valid, intervalSec: 60, timeoutMs: 5000 })).toMatchObject({
        minIntervalSec: 10,
        maxIntervalSec: 600,
      });
    });

    it('requires min <= base <= max when adaptive', () => {
      const tooSlowMin = create.safeParse({ ...valid, minIntervalSec: 120 });
      expect(tooSlowMin.error.issues[0].path).toEqual(['minIntervalSec']);
      const tooFastMax = create.safeParse({ ...valid, maxIntervalSec: 30 });
      expect(tooFastMax.error.issues[0].path).toEqual(['maxIntervalSec']);
      // Bounds are ignored when adaptive is off.
      expect(create.safeParse({ ...valid, adaptive: false, maxIntervalSec: 30 }).success).toBe(
        true,
      );
    });

    it('requires the timeout to fit the fastest adaptive interval (including the default one)', () => {
      const demo = buildMonitorSchemas({ demoMode: true });
      const result = demo.create.safeParse({ ...valid, intervalSec: 60, timeoutMs: 20_000 });
      expect(result.success).toBe(false);
      expect(result.error.issues[0].message).toMatch(/fastest adaptive interval/);
      expect(
        demo.create.safeParse({ ...valid, intervalSec: 60, timeoutMs: 20_000, adaptive: false })
          .success,
      ).toBe(true);
    });

    it('validates the budget and its action', () => {
      expect(create.parse({ ...valid, monthlyRequestBudget: '' }).monthlyRequestBudget).toBeNull();
      expect(create.parse({ ...valid, monthlyRequestBudget: '20000' }).monthlyRequestBudget).toBe(
        20000,
      );
      expect(create.safeParse({ ...valid, monthlyRequestBudget: 0 }).success).toBe(false);
      expect(create.safeParse({ ...valid, budgetAction: 'explode' }).success).toBe(false);
      expect(create.parse({ ...valid, budgetAction: 'pause' }).budgetAction).toBe('pause');
    });
  });

  it('accepts partial updates without filling in defaults, but not empty ones', () => {
    expect(Object.keys(update.parse({ name: 'Renamed' }))).toEqual(['name']);
    expect(update.safeParse({}).success).toBe(false);
  });
});
