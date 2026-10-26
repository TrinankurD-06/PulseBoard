import http from 'node:http';
import { mongoose } from '@pulseboard/shared/db';
import { CheckResult } from '@pulseboard/shared/models';
import {
  AGENDA_COLLECTION,
  createAgenda,
  createAgendaScheduler,
  ensureAgendaIndexes,
} from '@pulseboard/shared/scheduling';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, registerUser } from './helpers.js';

// These tests use the REAL Agenda scheduler (not a fake), and read the
// agendaJobs collection directly to prove what the API writes there.
let app, closeAgenda, jobs, server, targetUrl, owner, wid;

beforeAll(async () => {
  const replSet = await startMemoryDb();
  const created = createAgenda({ mongoUri: replSet.getUri('pulseboard-test'), name: 'api-test' });
  closeAgenda = created.close;
  await created.agenda.ready;
  await ensureAgendaIndexes(mongoose.connection.db);
  app = buildTestApp({ scheduler: createAgendaScheduler(created.agenda) });
  jobs = mongoose.connection.db.collection(AGENDA_COLLECTION);

  server = http.createServer((_req, res) => res.end('status: healthy'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${server.address().port}/`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeAgenda();
  await stopMemoryDb();
});

beforeEach(async () => {
  await clearMemoryDb();
  owner = await registerUser(app);
  wid = owner.workspaceId;
});

const monitorsUrl = (path = '') => `/api/v1/workspaces/${wid}/monitors${path}`;
const jobsFor = (monitorId) =>
  jobs.find({ name: 'run-check', 'data.monitorId': monitorId }).toArray();

async function createMonitor() {
  const res = await request(app)
    .post(monitorsUrl())
    .set(owner.auth)
    .send({ name: 'Local', url: targetUrl, intervalSec: 30 });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('Agenda jobs follow the monitor lifecycle', () => {
  it('create: one repeating run-check job, due immediately', async () => {
    const monitor = await createMonitor();
    const [job, ...extra] = await jobsFor(monitor.id);
    expect(extra).toHaveLength(0);
    expect(job.repeatInterval).toBe('30 seconds');
    expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('update interval: same job, new interval', async () => {
    const monitor = await createMonitor();
    await request(app)
      .patch(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth)
      .send({ intervalSec: 300 });
    const found = await jobsFor(monitor.id);
    expect(found).toHaveLength(1);
    expect(found[0].repeatInterval).toBe('300 seconds');
  });

  it('pause removes the job, resume brings it back', async () => {
    const monitor = await createMonitor();
    await request(app)
      .post(monitorsUrl(`/${monitor.id}/pause`))
      .set(owner.auth);
    expect(await jobsFor(monitor.id)).toHaveLength(0);
    await request(app)
      .post(monitorsUrl(`/${monitor.id}/resume`))
      .set(owner.auth);
    expect(await jobsFor(monitor.id)).toHaveLength(1);
  });

  it('delete removes the job', async () => {
    const monitor = await createMonitor();
    await request(app)
      .delete(monitorsUrl(`/${monitor.id}`))
      .set(owner.auth);
    expect(await jobsFor(monitor.id)).toHaveLength(0);
  });
});

describe('Test now', () => {
  it('runs a check on an unsaved config and returns the result without storing it', async () => {
    const res = await request(app)
      .post(monitorsUrl('/test'))
      .set(owner.auth)
      .send({ name: 'Draft', url: targetUrl, intervalSec: 30, keyword: 'healthy' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ok: true, statusCode: 200, error: null });
    expect(res.body.data.timings).toHaveProperty('ttfbMs');
    expect(await CheckResult.countDocuments()).toBe(0);
    expect(await jobs.countDocuments()).toBe(0);
  });

  it('tests a saved monitor', async () => {
    const monitor = await createMonitor();
    const res = await request(app)
      .post(monitorsUrl(`/${monitor.id}/test`))
      .set(owner.auth);
    expect(res.body.data.ok).toBe(true);
  });

  it('applies the SSRF guard', async () => {
    const strictApp = buildTestApp({ env: { ALLOW_PRIVATE_TARGETS: false } });
    const res = await request(strictApp)
      .post(monitorsUrl('/test'))
      .set(owner.auth)
      .send({ name: 'x', url: targetUrl, intervalSec: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSAFE_TARGET');
  });

  it('is limited to 5 per minute per user', async () => {
    const limitedApp = buildTestApp();
    const body = { name: 'Draft', url: targetUrl, intervalSec: 30 };
    for (let i = 0; i < 5; i += 1) {
      const ok = await request(limitedApp).post(monitorsUrl('/test')).set(owner.auth).send(body);
      expect(ok.status).toBe(200);
    }
    const limited = await request(limitedApp).post(monitorsUrl('/test')).set(owner.auth).send(body);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');

    // A different user has their own budget.
    const other = await registerUser(limitedApp);
    const otherRes = await request(limitedApp)
      .post(`/api/v1/workspaces/${other.workspaceId}/monitors/test`)
      .set(other.auth)
      .send(body);
    expect(otherRes.status).toBe(200);
  });
});
