import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CheckResult, Incident, Membership, User } from '../src/models/index.js';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../src/testing/memoryDb.js';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const oid = () => new mongoose.Types.ObjectId();

describe('models', () => {
  it('creates checkresults as a time-series collection with a 7-day TTL', async () => {
    const [info] = await mongoose.connection.db.listCollections({ name: 'checkresults' }).toArray();
    expect(info.type).toBe('timeseries');
    expect(info.options.timeseries).toMatchObject({ timeField: 'timestamp', metaField: 'meta' });
    expect(info.options.expireAfterSeconds).toBe(7 * 24 * 60 * 60);
  });

  it('never serialises passwordHash and exposes id instead of _id', async () => {
    const user = await User.create({ name: 'Ada', email: 'ADA@Example.com', passwordHash: 'x' });
    const json = user.toJSON();
    expect(json.passwordHash).toBeUndefined();
    expect(json._id).toBeUndefined();
    expect(json.id).toBe(user._id.toString());
    expect(json.email).toBe('ada@example.com');
  });

  it('rejects a duplicate membership for the same user and workspace', async () => {
    const membership = { workspaceId: oid(), userId: oid(), role: 'member' };
    await Membership.create(membership);
    await expect(Membership.create({ ...membership, role: 'owner' })).rejects.toMatchObject({
      code: 11000,
    });
  });

  it('allows only one open incident per monitor, but any number of resolved ones', async () => {
    const base = { monitorId: oid(), workspaceId: oid(), startedAt: new Date() };
    await Incident.create({ ...base, resolvedAt: new Date() });
    await Incident.create({ ...base, resolvedAt: new Date() });
    await Incident.create(base);
    await expect(Incident.create(base)).rejects.toMatchObject({ code: 11000 });
  });

  it('stores check results', async () => {
    await CheckResult.create({
      timestamp: new Date(),
      meta: { monitorId: oid(), workspaceId: oid() },
      ok: true,
      statusCode: 200,
      totalMs: 120,
    });
    expect(await CheckResult.countDocuments()).toBe(1);
  });
});
