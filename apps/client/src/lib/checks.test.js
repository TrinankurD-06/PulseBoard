import { describe, expect, it } from 'vitest';
import { failureCode, isOfflineCheck, responseRows, resultText } from './checks.js';

const t = '2026-10-27T12:00:00.000Z';

describe('responseRows', () => {
  it('keeps passed values and puts failed checks on the baseline, marked', () => {
    const [ok, failed] = responseRows([
      { t, ok: true, totalMs: 120 },
      { t, ok: false, totalMs: null, errorCode: 'HTTP_503' },
    ]);
    expect(ok).toMatchObject({ value: 120, failedValue: null, offline: false });
    expect(failed).toMatchObject({ value: 0, failedValue: 0, offline: false });
  });

  it('an unknown result is a gap, not zero and not failed', () => {
    const [row] = responseRows([{ t, ok: false, state: 'unknown', totalMs: null }]);
    expect(row.offline).toBe(true);
    expect(row.value).toBeNull();
    expect(row.failedValue).toBeNull();
  });
});

describe('resultText and failureCode', () => {
  it('labels each kind of result', () => {
    expect(resultText({ ok: true })).toBe('Passed');
    expect(resultText({ ok: false })).toBe('Failed');
    expect(resultText({ ok: false, state: 'unknown' })).toBe('Checker offline');
    expect(resultText({ ok: false, count: 12, upRatio: 0.9166 })).toBe('92% of 12 passed');
  });

  it('shows a code only on failed rows', () => {
    expect(failureCode({ ok: false, errorCode: 'ETIMEDOUT' })).toBe('ETIMEDOUT');
    expect(failureCode({ ok: true, errorCode: 'ETIMEDOUT' })).toBeNull();
    expect(failureCode({ ok: false, state: 'unknown', errorCode: 'ENOTFOUND' })).toBeNull();
    expect(failureCode({ ok: false })).toBeNull();
    expect(isOfflineCheck({ state: 'unknown' })).toBe(true);
  });
});
