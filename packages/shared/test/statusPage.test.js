import { describe, expect, it } from 'vitest';
import { statusPageSchema, updateStatusPageSchema } from '../src/schemas/index.js';
import { overallStatus } from '../src/statusPage.js';

describe('overallStatus', () => {
  it('is operational when nothing is down (pending counts as fine)', () => {
    expect(overallStatus(['up', 'up', 'pending'])).toBe('operational');
  });

  it('is a partial outage when some monitors are down', () => {
    expect(overallStatus(['up', 'down'])).toBe('partial_outage');
  });

  it('is a major outage when every active monitor is down', () => {
    expect(overallStatus(['down', 'down', 'paused'])).toBe('major_outage');
  });

  it('has no data without active monitors', () => {
    expect(overallStatus([])).toBe('no_data');
    expect(overallStatus(['paused'])).toBe('no_data');
  });
});

describe('statusPageSchema', () => {
  it('normalises the slug and applies defaults', () => {
    expect(statusPageSchema.parse({ title: 'Acme', slug: ' Acme-Status ' })).toEqual({
      title: 'Acme',
      slug: 'acme-status',
      description: '',
      monitorIds: [],
      isPublic: true,
    });
  });

  it('rejects unsafe or awkward slugs', () => {
    for (const slug of ['ab', 'has space', 'trailing-', '--double', 'under_score', 'é']) {
      expect(statusPageSchema.safeParse({ title: 'x', slug }).success).toBe(false);
    }
  });

  it('validates monitor ids and partial updates', () => {
    expect(
      statusPageSchema.safeParse({ title: 'x', slug: 'abc', monitorIds: ['nope'] }).success,
    ).toBe(false);
    expect(Object.keys(updateStatusPageSchema.parse({ isPublic: false }))).toEqual(['isPublic']);
    expect(updateStatusPageSchema.safeParse({}).success).toBe(false);
  });
});
