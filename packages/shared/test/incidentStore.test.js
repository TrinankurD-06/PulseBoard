import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mongoState } from '../src/db.js';
import {
  addTimelineEntry,
  openIncident,
  resolveOpenIncident,
  truncate,
} from '../src/incident/store.js';
import { Incident } from '../src/models/index.js';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../src/testing/memoryDb.js';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const monitor = { _id: new mongoose.Types.ObjectId(), workspaceId: new mongoose.Types.ObjectId() };
const t = (seconds) => new Date(Date.UTC(2026, 0, 1, 12, 0, seconds));

describe('incident store', () => {
  it('is connected through the shared db helper', () => {
    expect(mongoState()).toBe('connected');
  });

  it('opens an incident with an "opened" timeline entry', async () => {
    const incident = await openIncident(monitor, {
      startedAt: t(0),
      openedAt: t(20),
      cause: 'Connection refused',
      message: 'Down after 3 consecutive failed checks',
    });
    expect(incident).toMatchObject({ startedAt: t(0), cause: 'Connection refused' });
    expect(incident.timeline[0]).toMatchObject({ at: t(20), type: 'opened' });
  });

  it('returns null instead of opening a second incident for the same monitor', async () => {
    const args = { startedAt: t(0), openedAt: t(0), cause: 'x', message: 'down' };
    expect(await openIncident(monitor, args)).not.toBeNull();
    expect(await openIncident(monitor, args)).toBeNull();
    expect(await Incident.countDocuments()).toBe(1);
  });

  it('resolves the open incident once, computing its duration', async () => {
    await openIncident(monitor, { startedAt: t(0), openedAt: t(0), cause: 'x', message: 'down' });

    const [first, second] = await Promise.all([
      resolveOpenIncident(monitor._id, { resolvedAt: t(45), message: 'Recovered' }),
      resolveOpenIncident(monitor._id, { resolvedAt: t(50), message: 'Recovered' }),
    ]);
    const resolved = [first, second].filter(Boolean);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].durationSec).toBeGreaterThanOrEqual(45);
    expect(resolved[0].timeline.at(-1).type).toBe('resolved');
  });

  it('returns null when there is nothing to resolve', async () => {
    expect(await resolveOpenIncident(monitor._id, { resolvedAt: t(1), message: 'x' })).toBeNull();
  });

  it('appends timeline entries, truncating long messages', async () => {
    const incident = await openIncident(monitor, {
      startedAt: t(0),
      openedAt: t(0),
      cause: 'x',
      message: 'down',
    });
    await addTimelineEntry(incident._id, { type: 'alert_failed', message: 'e'.repeat(800) });
    const { timeline } = await Incident.findById(incident._id).lean();
    expect(timeline.at(-1).message).toHaveLength(500);
    expect(truncate('short')).toBe('short');
  });
});
