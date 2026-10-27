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

  it('allows users without a password (OAuth-only) and exposes only provider names', async () => {
    const user = await User.create({
      name: 'Ada',
      email: 'ada@example.com',
      identities: [{ provider: 'github', providerId: '42', email: 'ada@example.com' }],
    });
    const json = user.toJSON();
    expect(json).toMatchObject({ providers: ['github'], hasPassword: false });
    expect(json.identities).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('42');

    // A partial load (e.g. populate 'name email') adds neither field.
    const partial = (await User.findById(user._id).select('name email')).toJSON();
    expect(partial.providers).toBeUndefined();
    expect(partial.hasPassword).toBeUndefined();
  });

  it('links one provider account to at most one user; users without identities never collide', async () => {
    await User.create({ name: 'A', email: 'a@example.com', passwordHash: 'x' });
    await User.create({ name: 'B', email: 'b@example.com', passwordHash: 'x' });
    const identity = { provider: 'google', providerId: 'g-1' };
    await User.create({ name: 'C', email: 'c@example.com', identities: [identity] });
    await expect(
      User.create({ name: 'D', email: 'd@example.com', identities: [identity] }),
    ).rejects.toMatchObject({ code: 11000 });
    // The same id at a different provider is a different account.
    await User.create({
      name: 'E',
      email: 'e@example.com',
      identities: [{ provider: 'github', providerId: 'g-1' }],
    });
    await expect(
      User.create({
        name: 'F',
        email: 'f@example.com',
        identities: [{ provider: 'x', providerId: '1' }],
      }),
    ).rejects.toThrow(/provider/);
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
