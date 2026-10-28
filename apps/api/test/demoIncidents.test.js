import { mongoose } from '@pulseboard/shared/db';
import {
  CheckResult,
  DailyRollup,
  Incident,
  Monitor,
  MonitorUsage,
} from '@pulseboard/shared/models';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addDemoIncidentMonitor,
  DEMO_INCIDENTS,
  DEMO_MONITOR_NAME,
} from '../scripts/lib/demoIncidents.js';
import { clearSeedData } from '../scripts/lib/seedClear.js';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);

const workspaceId = new mongoose.Types.ObjectId();
let realMonitor;

beforeEach(async () => {
  await clearMemoryDb();
  realMonitor = await Monitor.create({
    workspaceId,
    name: 'Real site',
    url: 'https://real.example',
    intervalSec: 60,
  });
});

describe('addDemoIncidentMonitor', () => {
  it('creates one flagged monitor with resolved incidents, checks, rollups and usage', async () => {
    const { monitor, incidents } = await addDemoIncidentMonitor({ workspaceId });
    expect(monitor).toMatchObject({ name: DEMO_MONITOR_NAME, isSeed: true, status: 'up' });
    expect(incidents).toBe(DEMO_INCIDENTS.length);

    const found = await Incident.find({ monitorId: monitor._id }).lean();
    expect(found).toHaveLength(DEMO_INCIDENTS.length);
    for (const incident of found) {
      expect(incident).toMatchObject({ isSeed: true });
      expect(incident.resolvedAt).toBeTruthy();
      expect(incident.causeCode).toBeTruthy();
      const types = incident.timeline.map((entry) => entry.type);
      expect(types[0]).toBe('opened');
      expect(types).toContain('resolved');
      expect(types.at(-1)).toBe('alert_sent');
    }
    // One incident shows a failed first alert that was retried.
    expect(found.some((i) => i.timeline.some((e) => e.type === 'alert_failed'))).toBe(true);

    const checks = await CheckResult.find({ 'meta.monitorId': monitor._id }).lean();
    expect(checks.every((c) => c.isSeed)).toBe(true);
    expect(checks.some((c) => !c.ok && c.errorCode === 'HTTP_500')).toBe(true);
    expect(
      await DailyRollup.countDocuments({ monitorId: monitor._id, isSeed: true }),
    ).toBeGreaterThanOrEqual(30);
    expect(await MonitorUsage.countDocuments({ monitorId: monitor._id, isSeed: true })).toBe(1);
  });

  it('only one incident can be open at a time and none is left open', async () => {
    const { monitor } = await addDemoIncidentMonitor({ workspaceId });
    expect(await Incident.countDocuments({ monitorId: monitor._id, resolvedAt: null })).toBe(0);
  });

  it('replaces the previous demo monitor when run twice, and never touches real monitors', async () => {
    await addDemoIncidentMonitor({ workspaceId });
    const second = await addDemoIncidentMonitor({ workspaceId });
    expect(second.replaced).toBe(1);
    expect(await Monitor.countDocuments({ name: DEMO_MONITOR_NAME })).toBe(1);
    expect(await Incident.countDocuments({})).toBe(DEMO_INCIDENTS.length);
    expect(await Monitor.exists({ _id: realMonitor._id })).toBeTruthy();
  });

  it('is removed completely by seed:clear, leaving real data', async () => {
    await addDemoIncidentMonitor({ workspaceId });
    await clearSeedData({ logger: { warn() {} } });
    expect(await Monitor.find({}).lean()).toHaveLength(1);
    expect(await Monitor.exists({ _id: realMonitor._id })).toBeTruthy();
    expect(await Incident.countDocuments({})).toBe(0);
    expect(await CheckResult.countDocuments({})).toBe(0);
    expect(await DailyRollup.countDocuments({})).toBe(0);
    expect(await MonitorUsage.countDocuments({})).toBe(0);
  });
});
