import { createLogger } from '@pulseboard/shared/logger';
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from '@pulseboard/shared/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { envSchema } from '../src/config/env.js';
import { startCombinedWorker } from '../src/combined.js';
import { buildTestApp, testEnv } from './helpers.js';

const logger = createLogger({ name: 'combined-test' });
let replSet;

beforeAll(async () => {
  replSet = await startMemoryDb();
});
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const minimalEnv = {
  MONGODB_URI: 'mongodb://localhost:27017/pulseboard',
  CLIENT_ORIGIN: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('RUN_MODE', () => {
  it('defaults to api, accepts combined, and rejects anything else', () => {
    expect(envSchema.parse(minimalEnv).RUN_MODE).toBe('api');
    expect(envSchema.parse({ ...minimalEnv, RUN_MODE: 'combined' }).RUN_MODE).toBe('combined');
    expect(envSchema.safeParse({ ...minimalEnv, RUN_MODE: 'worker' }).success).toBe(false);
  });

  it('has a default check concurrency for the combined worker', () => {
    expect(envSchema.parse(minimalEnv).AGENDA_MAX_CONCURRENCY).toBe(20);
    expect(
      envSchema.parse({ ...minimalEnv, AGENDA_MAX_CONCURRENCY: '5' }).AGENDA_MAX_CONCURRENCY,
    ).toBe(5);
  });
});

describe('startCombinedWorker', () => {
  it('does nothing, and never loads the worker, in api mode', async () => {
    const loadWorker = vi.fn();
    const worker = await startCombinedWorker({ env: { RUN_MODE: 'api' }, logger, loadWorker });
    expect(worker).toBeNull();
    expect(loadWorker).not.toHaveBeenCalled();
  });

  it('starts the worker with this env and a worker-tagged logger in combined mode', async () => {
    const running = { isRunning: () => true, stop: vi.fn() };
    const startWorker = vi.fn(async () => running);
    const child = vi.fn(() => 'child-logger');
    const env = { RUN_MODE: 'combined', MONGODB_URI: 'x' };

    const worker = await startCombinedWorker({
      env,
      logger: { child },
      loadWorker: async () => ({ startWorker }),
    });

    expect(worker).toBe(running);
    expect(child).toHaveBeenCalledWith({ role: 'worker' });
    expect(startWorker).toHaveBeenCalledWith(
      expect.objectContaining({ env, logger: 'child-logger' }),
    );
    expect(startWorker.mock.calls[0][0].agendaName).toMatch(/^combined-/);
  });

  it('resolves the real worker package and runs it against MongoDB', async () => {
    const env = {
      ...testEnv,
      RUN_MODE: 'combined',
      MONGODB_URI: replSet.getUri('pulseboard-test'),
      AGENDA_MAX_CONCURRENCY: 5,
      ALLOW_PRIVATE_TARGETS: false,
    };
    const worker = await startCombinedWorker({ env, logger });
    try {
      expect(worker.isRunning()).toBe(true);
    } finally {
      await worker.stop();
    }
    expect(worker.isRunning()).toBe(false);
  }, 30_000);
});

describe('GET /health worker status', () => {
  it('reports the worker as off when the API runs alone', async () => {
    const res = await request(buildTestApp()).get('/health');
    expect(res.body.worker).toBe('off');
    expect(res.body.status).toBe('degraded'); // no change streams in this app, as before
  });

  it('is ok with a running combined worker and degraded when it has stopped', async () => {
    const live = { getRealtimeStatus: () => ({ monitors: 'live', incidents: 'live' }) };
    const running = await request(buildTestApp({ ...live, getWorkerStatus: () => 'running' })).get(
      '/health',
    );
    expect(running.body).toMatchObject({ status: 'ok', worker: 'running' });

    const stopped = await request(buildTestApp({ ...live, getWorkerStatus: () => 'stopped' })).get(
      '/health',
    );
    expect(stopped.status).toBe(200);
    expect(stopped.body).toMatchObject({ status: 'degraded', worker: 'stopped' });
  });
});
