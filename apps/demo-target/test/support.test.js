import { describe, expect, it, vi } from 'vitest';
import { createAgentController } from '../src/agentController.js';
import { loadAgentConfig, loadHeartbeatUrl, readDemoFile } from '../src/demoConfig.js';
import { parseArgs, runHeartbeat, runUrls } from '../src/heartbeat.js';
import { trafficPath } from '../src/traffic.js';

const file = {
  agentKey: 'pbk_file',
  endpoint: 'http://localhost:4000/api/v1',
  heartbeatUrl: 'http://localhost:4000/api/v1/ping/tok123',
};

describe('agent config', () => {
  it('prefers env over the seed file', () => {
    const env = {
      PULSEBOARD_AGENT_KEY: 'pbk_env',
      PULSEBOARD_ENDPOINT: 'https://pb.example/api/v1',
    };
    expect(loadAgentConfig({ env, file })).toEqual({
      apiKey: 'pbk_env',
      endpoint: 'https://pb.example/api/v1',
      reportEverySec: 30,
      source: 'env',
    });
  });

  it('falls back to the seed file, and to no agent at all', () => {
    expect(loadAgentConfig({ env: {}, file })).toMatchObject({
      apiKey: 'pbk_file',
      source: 'file',
    });
    expect(loadAgentConfig({ env: {}, file: { ...file, reportEverySec: 60 } }).reportEverySec).toBe(
      60,
    );
    expect(loadAgentConfig({ env: {}, file: null })).toBeNull();
    // Half-configured env doesn't count.
    expect(loadAgentConfig({ env: { PULSEBOARD_AGENT_KEY: 'pbk_x' }, file: null })).toBeNull();
  });

  it('reads the heartbeat URL from env or the file', () => {
    expect(loadHeartbeatUrl({ env: { HEARTBEAT_URL: 'http://x/ping/a' }, file })).toBe(
      'http://x/ping/a',
    );
    expect(loadHeartbeatUrl({ env: {}, file })).toBe(file.heartbeatUrl);
    expect(loadHeartbeatUrl({ env: {}, file: null })).toBeNull();
  });

  it('treats a missing or broken seed file as absent', () => {
    expect(readDemoFile('nope.json')).toBeNull();
    expect(readDemoFile('x', () => '{not json')).toBeNull();
    expect(readDemoFile('x', () => JSON.stringify(file))).toEqual(file);
  });
});

describe('agent controller', () => {
  const config = { apiKey: 'pbk_a', endpoint: 'http://pb/api/v1', reportEverySec: 30 };
  const factory = () => {
    const created = [];
    const createAgent = vi.fn((options) => {
      const instance = (_req, _res, next) => next();
      instance.stop = vi.fn(async () => {});
      instance.options = options;
      created.push(instance);
      return instance;
    });
    return { created, createAgent };
  };

  it('is off without a config and passes requests through', () => {
    const controller = createAgentController({ config: null });
    const next = vi.fn();
    controller.middleware({}, {}, next);
    expect(next).toHaveBeenCalled();
    expect(controller.status().state).toBe('off');
  });

  it('starts, stops and restarts with a fresh instance', async () => {
    const { created, createAgent } = factory();
    const controller = createAgentController({ config, createAgent });
    expect(created[0].options).toMatchObject({ apiKey: 'pbk_a', intervalSec: 30 });
    controller.start(); // already running: no second instance
    expect(created).toHaveLength(1);

    await controller.stop();
    expect(controller.status().state).toBe('stopped');
    await controller.restart();
    expect(created).toHaveLength(2);
    expect(controller.isReporting()).toBe(true);
  });

  it('picks up a new key, but leaves an agent stopped by a scenario stopped', async () => {
    const { created, createAgent } = factory();
    const controller = createAgentController({ config: null, createAgent });
    await controller.configure(config);
    expect(controller.isReporting()).toBe(true);

    await controller.stop();
    await controller.configure({ ...config, apiKey: 'pbk_b' });
    expect(controller.status().state).toBe('stopped');
    await controller.restart();
    expect(created.at(-1).options.apiKey).toBe('pbk_b');
  });
});

describe('background traffic', () => {
  it('rotates through the site routes with an occasional 404', () => {
    const paths = Array.from({ length: 25 }, (_, n) => trafficPath(n, () => 0.5));
    expect(paths.slice(0, 3)).toEqual(['/', '/api/products', '/api/orders/5500']);
    expect(paths[24]).toBe('/api/orders/unknown');
  });
});

describe('heartbeat cron', () => {
  it('parses flags', () => {
    expect(parseArgs([])).toEqual({ everySec: 30, fail: false, stopAfter: null, help: false });
    expect(parseArgs(['--fail', '--every', '10', '--stop-after', '3'])).toMatchObject({
      everySec: 10,
      fail: true,
      stopAfter: 3,
    });
    expect(() => parseArgs(['--every', '0'])).toThrow(/whole number/);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
  });

  it('builds /start, ping and /fail URLs', () => {
    expect(runUrls('http://pb/api/v1/ping/tok/')).toEqual({
      start: 'http://pb/api/v1/ping/tok/start',
      finish: 'http://pb/api/v1/ping/tok',
    });
    expect(runUrls('http://pb/api/v1/ping/tok', { fail: true }).finish).toBe(
      'http://pb/api/v1/ping/tok/fail?message=Backup%20failed%3A%20disk%20full',
    );
  });

  it('sends /start then a ping per run and stops after n runs, surviving errors', async () => {
    const calls = [];
    const fetch = vi.fn(async (url) => {
      calls.push(url);
      if (calls.length === 2) throw new Error('offline');
      return { ok: true, status: 200 };
    });
    const sleeps = [];
    const runs = await runHeartbeat({
      heartbeatUrl: 'http://pb/ping/tok',
      everySec: 10,
      stopAfter: 2,
      fetch,
      sleep: async (ms) => sleeps.push(ms),
      log: () => {},
    });
    expect(runs).toBe(2);
    expect(calls).toEqual([
      'http://pb/ping/tok/start',
      'http://pb/ping/tok',
      'http://pb/ping/tok/start',
      'http://pb/ping/tok',
    ]);
    // work, wait, work: no wait after the last run.
    expect(sleeps).toEqual([1500, 10_000, 1500]);
  });
});
