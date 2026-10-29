import { describe, expect, it } from 'vitest';
import { isDemoReadOnly } from './demo.js';

const ON = { demoReadOnly: true, demoEmail: 'demo@pulseboard.dev' };

describe('isDemoReadOnly', () => {
  it('is false when the flag is off', () => {
    expect(
      isDemoReadOnly({ demoReadOnly: false, demoEmail: null }, { email: 'demo@pulseboard.dev' }),
    ).toBe(false);
  });
  it('is false for any other user', () => {
    expect(isDemoReadOnly(ON, { email: 'someone@example.com' })).toBe(false);
  });
  it('is true for the demo user', () => {
    expect(isDemoReadOnly(ON, { email: 'demo@pulseboard.dev' })).toBe(true);
  });
  it('ignores email case', () => {
    expect(isDemoReadOnly(ON, { email: 'Demo@PulseBoard.dev' })).toBe(true);
  });
  it('tolerates missing meta or user', () => {
    expect(isDemoReadOnly(undefined, { email: 'demo@pulseboard.dev' })).toBe(false);
    expect(isDemoReadOnly(ON, null)).toBe(false);
    expect(isDemoReadOnly(ON, {})).toBe(false);
    expect(isDemoReadOnly(undefined, undefined)).toBe(false);
  });
});
