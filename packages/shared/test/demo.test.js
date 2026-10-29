import { DEMO_OWNER_DEFAULT_EMAIL, DEMO_USER_EMAIL, ROLES } from '../src/constants.js';
import {
  DEMO_MONITOR_NAME,
  ensureReadOnlyDemo,
  isDemoUserEmail,
  resetDemoData,
} from '../src/demo/index.js';
import { Incident, Membership, Monitor, StatusPage, User, Workspace } from '../src/models/index.js';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '../src/testing/memoryDb.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

let slugCounter = 0;
async function workspaceOf(user, role = ROLES.OWNER) {
  slugCounter += 1;
  const workspace = await Workspace.create({
    name: `WS ${slugCounter}`,
    slug: `ws-${slugCounter}`,
    ownerId: user._id,
  });
  await Membership.create({ workspaceId: workspace._id, userId: user._id, role });
  return workspace;
}

const makeUser = (email, extra = {}) => User.create({ name: email, email, ...extra });
const roleOf = async (workspace, user) =>
  (await Membership.findOne({ workspaceId: workspace._id, userId: user._id }))?.role;
const ownersOf = (workspace) =>
  Membership.countDocuments({ workspaceId: workspace._id, role: ROLES.OWNER });

describe('isDemoUserEmail', () => {
  it('matches the demo address case-insensitively and nothing else', () => {
    expect(isDemoUserEmail(DEMO_USER_EMAIL)).toBe(true);
    expect(isDemoUserEmail(` ${DEMO_USER_EMAIL.toUpperCase()} `)).toBe(true);
    expect(isDemoUserEmail('someone@example.com')).toBe(false);
    expect(isDemoUserEmail(undefined)).toBe(false);
  });
});

describe('ensureReadOnlyDemo', () => {
  it('does nothing without a demo user', async () => {
    const other = await makeUser('other@example.com');
    const ws = await workspaceOf(other);
    expect(await ensureReadOnlyDemo()).toEqual({ demoUser: false, demoted: 0, workspaceIds: [] });
    expect(await roleOf(ws, other)).toBe(ROLES.OWNER);
    expect(await User.countDocuments()).toBe(1);
  });

  it('demotes the demo owner to Viewer and promotes a password-less default owner', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL, { passwordHash: 'x' });
    const ws = await workspaceOf(demo);
    const result = await ensureReadOnlyDemo();
    expect(result).toMatchObject({ demoUser: true, demoted: 1 });

    expect(await roleOf(ws, demo)).toBe(ROLES.VIEWER);
    const owner = await User.findOne({ email: DEMO_OWNER_DEFAULT_EMAIL });
    expect(owner).toBeTruthy();
    expect(owner.passwordHash).toBeFalsy();
    expect(await roleOf(ws, owner)).toBe(ROLES.OWNER);
  });

  it('uses the existing account named by ownerEmail', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL);
    const boss = await makeUser('boss@example.com');
    const ws = await workspaceOf(demo);
    await ensureReadOnlyDemo({ ownerEmail: 'Boss@Example.com' });
    expect(await roleOf(ws, boss)).toBe(ROLES.OWNER);
    expect(await roleOf(ws, demo)).toBe(ROLES.VIEWER);
    expect(await User.findOne({ email: DEMO_OWNER_DEFAULT_EMAIL })).toBeNull();
  });

  it('never names the demo user as its own owner', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL);
    const ws = await workspaceOf(demo);
    await ensureReadOnlyDemo({ ownerEmail: DEMO_USER_EMAIL });
    expect(await roleOf(ws, demo)).toBe(ROLES.VIEWER);
    expect(await ownersOf(ws)).toBe(1);
  });

  it('is idempotent', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL);
    const ws = await workspaceOf(demo);
    await ensureReadOnlyDemo();
    const again = await ensureReadOnlyDemo();
    expect(again).toMatchObject({ demoUser: true, demoted: 0 });
    expect(await User.countDocuments()).toBe(2);
    expect(await Membership.countDocuments({ workspaceId: ws._id })).toBe(2);
    expect(await ownersOf(ws)).toBe(1);
  });

  it('keeps an existing second owner instead of adding an owner account', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL);
    const real = await makeUser('real@example.com');
    const ws = await workspaceOf(demo);
    await Membership.create({ workspaceId: ws._id, userId: real._id, role: ROLES.OWNER });
    await ensureReadOnlyDemo();
    expect(await User.findOne({ email: DEMO_OWNER_DEFAULT_EMAIL })).toBeNull();
    expect(await roleOf(ws, real)).toBe(ROLES.OWNER);
    expect(await roleOf(ws, demo)).toBe(ROLES.VIEWER);
  });

  it('demotes a member too, without needing an owner account', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL);
    const real = await makeUser('real@example.com');
    const ws = await workspaceOf(real);
    await Membership.create({ workspaceId: ws._id, userId: demo._id, role: ROLES.MEMBER });
    const result = await ensureReadOnlyDemo();
    expect(result.demoted).toBe(1);
    expect(await roleOf(ws, demo)).toBe(ROLES.VIEWER);
    expect(await User.countDocuments()).toBe(2);
  });

  it('handles every workspace of the demo user and never leaves one without an owner', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL);
    const real = await makeUser('real@example.com');
    const mine = await workspaceOf(demo);
    const second = await workspaceOf(demo);
    const theirs = await workspaceOf(real);
    await Membership.create({ workspaceId: theirs._id, userId: demo._id, role: ROLES.VIEWER });

    const result = await ensureReadOnlyDemo();
    expect(result.workspaceIds).toHaveLength(3);
    for (const ws of [mine, second, theirs]) {
      expect(await roleOf(ws, demo)).toBe(ROLES.VIEWER);
      expect(await ownersOf(ws)).toBe(1);
    }
  });
});

describe('resetDemoData', () => {
  it('does nothing without a demo user', async () => {
    expect(await resetDemoData()).toMatchObject({ demoUser: false, refreshed: 0 });
    expect(await Monitor.countDocuments()).toBe(0);
  });

  it('re-applies the role even when the demo workspace has no sample monitor yet', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL);
    const ws = await workspaceOf(demo);
    const result = await resetDemoData();
    expect(result).toMatchObject({ demoUser: true, demoted: 1, refreshed: 0 });
    expect(await roleOf(ws, demo)).toBe(ROLES.VIEWER);
    expect(await Monitor.countDocuments({ workspaceId: ws._id })).toBe(0);
  });

  it('rebuilds the sample monitor, keeps its status page entry and leaves real monitors alone', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL);
    const ws = await workspaceOf(demo);
    const real = await Monitor.create({
      workspaceId: ws._id,
      name: 'Real site',
      url: 'https://real.example',
      intervalSec: 60,
    });
    const sample = await Monitor.create({
      workspaceId: ws._id,
      name: DEMO_MONITOR_NAME,
      url: 'https://example.com/',
      intervalSec: 60,
      isSeed: true,
    });
    const page = await StatusPage.create({
      workspaceId: ws._id,
      slug: 'demo-page',
      title: 'Demo',
      monitorIds: [real._id, sample._id],
      isPublic: true,
    });

    const first = await resetDemoData();
    expect(first.refreshed).toBe(1);

    const samples = await Monitor.find({ workspaceId: ws._id, name: DEMO_MONITOR_NAME }).lean();
    expect(samples).toHaveLength(1);
    expect(String(samples[0]._id)).not.toBe(String(sample._id));
    expect(await Monitor.findById(real._id)).toBeTruthy();
    expect(await Incident.countDocuments({ monitorId: samples[0]._id })).toBeGreaterThan(0);

    const reloaded = await StatusPage.findById(page._id).lean();
    expect(reloaded.monitorIds.map(String).sort()).toEqual(
      [String(real._id), String(samples[0]._id)].sort(),
    );

    // A second reset replaces it again, still exactly one sample monitor on the page.
    await resetDemoData();
    const after = await Monitor.find({ workspaceId: ws._id, name: DEMO_MONITOR_NAME }).lean();
    expect(after).toHaveLength(1);
    const page2 = await StatusPage.findById(page._id).lean();
    expect(page2.monitorIds.map(String).sort()).toEqual(
      [String(real._id), String(after[0]._id)].sort(),
    );
  });

  it('does not put the sample monitor on a page that did not list it', async () => {
    const demo = await makeUser(DEMO_USER_EMAIL);
    const ws = await workspaceOf(demo);
    await Monitor.create({
      workspaceId: ws._id,
      name: DEMO_MONITOR_NAME,
      url: 'https://example.com/',
      intervalSec: 60,
      isSeed: true,
    });
    const page = await StatusPage.create({
      workspaceId: ws._id,
      slug: 'empty-page',
      title: 'Empty',
      monitorIds: [],
      isPublic: true,
    });
    await resetDemoData();
    expect((await StatusPage.findById(page._id).lean()).monitorIds).toHaveLength(0);
  });
});
