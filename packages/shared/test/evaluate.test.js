import { describe, expect, it } from 'vitest';
import { evaluateCheck } from '../src/check/evaluate.js';

const monitor = { expectedStatus: { min: 200, max: 399 }, keyword: null };

describe('evaluateCheck', () => {
  it('passes a 2xx/3xx response with no keyword', () => {
    expect(evaluateCheck({ statusCode: 200 }, monitor)).toEqual({ ok: true, error: null });
    expect(evaluateCheck({ statusCode: 399 }, monitor).ok).toBe(true);
  });

  it('fails on a network error, whatever else is set', () => {
    expect(evaluateCheck({ error: 'Connection refused' }, monitor)).toEqual({
      ok: false,
      error: 'Connection refused',
    });
  });

  it('fails when the status is outside the expected range (both edges)', () => {
    expect(evaluateCheck({ statusCode: 500 }, monitor)).toEqual({
      ok: false,
      error: 'Unexpected status 500 (expected 200–399)',
    });
    expect(evaluateCheck({ statusCode: 199 }, monitor).ok).toBe(false);
    expect(evaluateCheck({ statusCode: 400 }, monitor).ok).toBe(false);
  });

  it('supports custom ranges, e.g. expecting a 404', () => {
    const expect404 = { expectedStatus: { min: 404, max: 404 } };
    expect(evaluateCheck({ statusCode: 404 }, expect404).ok).toBe(true);
    expect(evaluateCheck({ statusCode: 200 }, expect404).ok).toBe(false);
  });

  it('requires the keyword (case-sensitive) when one is set', () => {
    const withKeyword = { ...monitor, keyword: 'healthy' };
    expect(evaluateCheck({ statusCode: 200, body: 'status: healthy' }, withKeyword).ok).toBe(true);
    expect(evaluateCheck({ statusCode: 200, body: 'status: HEALTHY' }, withKeyword)).toEqual({
      ok: false,
      error: 'Keyword "healthy" not found in response',
    });
    expect(evaluateCheck({ statusCode: 200, body: null }, withKeyword).ok).toBe(false);
  });

  it('checks the status before the keyword', () => {
    const withKeyword = { ...monitor, keyword: 'healthy' };
    expect(evaluateCheck({ statusCode: 503, body: 'healthy' }, withKeyword).error).toMatch(
      /Unexpected status 503/,
    );
  });
});
