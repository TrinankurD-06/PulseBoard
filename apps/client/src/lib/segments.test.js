import { describe, expect, it } from 'vitest';
import { offlineBands, segmentSeries, splitSegments } from './segments.js';

describe('splitSegments', () => {
  it('returns one segment when there are no gaps', () => {
    expect(splitSegments([1, 2, 3])).toEqual([{ start: 0, end: 2 }]);
  });
  it('returns nothing for empty and all-null series', () => {
    expect(splitSegments([])).toEqual([]);
    expect(splitSegments([null, undefined, NaN])).toEqual([]);
  });
  it('handles a single point', () => {
    expect(splitSegments([5])).toEqual([{ start: 0, end: 0 }]);
  });
  it('drops leading and trailing nulls', () => {
    expect(splitSegments([null, null, 1, 2, null])).toEqual([{ start: 2, end: 3 }]);
  });
  it('treats consecutive nulls as one gap', () => {
    expect(splitSegments([1, 2, null, null, null, 3, 4])).toEqual([
      { start: 0, end: 1 },
      { start: 5, end: 6 },
    ]);
  });
  it('keeps one point between gaps as a segment of its own', () => {
    expect(splitSegments([null, 1, null, 2, 3, null, 4, null])).toEqual([
      { start: 1, end: 1 },
      { start: 3, end: 4 },
      { start: 6, end: 6 },
    ]);
  });
  it('treats zero as a value, not a gap', () => {
    expect(splitSegments([0, 0, null, 0])).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 3 },
    ]);
  });
});

describe('segmentSeries', () => {
  const rows = (values) => values.map((v, i) => ({ t: i, v }));

  it('gives every run of 2+ points its own key, only on its own rows', () => {
    const out = segmentSeries(rows([1, 2, null, 3, 4, 5]), 'v', 's');
    expect(out.lineKeys).toEqual(['s0', 's1']);
    expect(out.dotKey).toBeNull();
    expect(out.rows.map((r) => r.s0)).toEqual([1, 2, undefined, undefined, undefined, undefined]);
    expect(out.rows.map((r) => r.s1)).toEqual([undefined, undefined, undefined, 3, 4, 5]);
  });

  it('puts lone points on the dot key and never on a line key', () => {
    const out = segmentSeries(rows([null, 1, null, 2, 3, null, 4]), 'v', 's');
    expect(out.lineKeys).toEqual(['s0']);
    expect(out.dotKey).toBe('sdot');
    expect(out.rows.map((r) => r.sdot)).toEqual([
      undefined,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      4,
    ]);
    expect(out.rows.map((r) => r.s0)).toEqual([
      undefined,
      undefined,
      undefined,
      2,
      3,
      undefined,
      undefined,
    ]);
  });

  it('an all-null series yields no keys', () => {
    const out = segmentSeries(rows([null, null]), 'v');
    expect(out.lineKeys).toEqual([]);
    expect(out.dotKey).toBeNull();
  });

  it('leaves the original rows untouched', () => {
    const input = rows([1, 2]);
    segmentSeries(input, 'v');
    expect(input[0]).toEqual({ t: 0, v: 1 });
  });
});

describe('offlineBands', () => {
  const times = [0, 10, 20, 30, 40, 50];

  it('is empty without offline rows', () => {
    expect(
      offlineBands(
        times,
        times.map(() => false),
      ),
    ).toEqual([]);
    expect(offlineBands([], [])).toEqual([]);
  });
  it('extends half a step each side of a run', () => {
    expect(offlineBands(times, [false, false, true, true, false, false])).toEqual([
      { x1: 15, x2: 35 },
    ]);
  });
  it('clamps to the data extent at both ends', () => {
    expect(offlineBands(times, [true, false, false, false, false, true])).toEqual([
      { x1: 0, x2: 5 },
      { x1: 45, x2: 50 },
    ]);
  });
  it('makes one band per separate run', () => {
    expect(offlineBands(times, [false, true, false, true, false, false])).toEqual([
      { x1: 5, x2: 15 },
      { x1: 25, x2: 35 },
    ]);
  });
  it('gives a lone row a width using the median step', () => {
    expect(offlineBands([0, 10, 20], [false, true, false])).toEqual([{ x1: 5, x2: 15 }]);
  });
});
