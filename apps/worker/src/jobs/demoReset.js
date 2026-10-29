import { resetDemoData } from '@pulseboard/shared/demo';

/**
 * `demo-reset`: runs daily at 03:00 UTC when DEMO_READ_ONLY is on. Re-applies the demo
 * user's read-only role and rebuilds the sample "Demo Checkout API" monitor, so the public
 * demo always looks fresh (see resetDemoData). Real monitors, users and channels are untouched.
 * Returns the resetDemoData result.
 */
export function createDemoResetJob({ ownerEmail, logger }) {
  return async function demoResetJob(now = Date.now()) {
    return resetDemoData({ ownerEmail, now, logger });
  };
}
