import { DEMO_USER_EMAIL } from '@pulseboard/shared/constants';
import { DEMO_MONITOR_NAME } from '@pulseboard/shared/demo';
import { createLogger } from '@pulseboard/shared/logger';
import { Membership, Monitor, User, Workspace } from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDemoResetJob } from '../src/jobs/demoReset.js';

const logger = createLogger({ name: 'demo-reset-test' });
beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

describe('demo reset job', () => {
  it('does nothing when there is no demo user', async () => {
    const result = await createDemoResetJob({ logger })();
    expect(result).toMatchObject({ demoUser: false, refreshed: 0 });
  });

  it('re-applies read-only and rebuilds the sample monitor, leaving real ones alone', async () => {
    const user = await User.create({ name: 'Demo', email: DEMO_USER_EMAIL });
    const workspace = await Workspace.create({ name: 'Demo', slug: 'demo-job', ownerId: user._id });
    await Membership.create({ workspaceId: workspace._id, userId: user._id, role: 'owner' });
    const real = await Monitor.create({
      workspaceId: workspace._id,
      name: 'Real site',
      url: 'https://real.example',
      intervalSec: 60,
    });
    const sample = await Monitor.create({
      workspaceId: workspace._id,
      name: DEMO_MONITOR_NAME,
      url: 'https://example.com/',
      intervalSec: 60,
      isSeed: true,
    });

    const result = await createDemoResetJob({ logger })();
    expect(result).toMatchObject({ demoUser: true, refreshed: 1 });
    const membership = await Membership.findOne({ workspaceId: workspace._id, userId: user._id });
    expect(membership.role).toBe('viewer');
    expect(await Monitor.findById(real._id)).toBeTruthy();
    expect(await Monitor.findById(sample._id)).toBeNull();
    expect(await Monitor.countDocuments({ name: DEMO_MONITOR_NAME })).toBe(1);
  });
});
