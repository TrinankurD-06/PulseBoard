import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AGENT_VERSION, pulseboard } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('the built package (dist)', () => {
  beforeAll(() => {
    execFileSync(process.execPath, [join(root, 'scripts', 'build.js')], { stdio: 'pipe' });
  });

  it('loads as ESM with the public API', async () => {
    const esm = await import(pathToFileURL(join(root, 'dist', 'index.js')).href);
    expect(esm.pulseboard).toBeTypeOf('function');
    expect(esm.default).toBe(esm.pulseboard);
    expect(esm.heartbeat).toBeTypeOf('function');
    expect(esm.AGENT_VERSION).toBe(pkg.version);
  });

  it('loads with require() (CommonJS) and works', async () => {
    const cjs = createRequire(import.meta.url)(join(root, 'dist', 'index.cjs'));
    expect(cjs.pulseboard).toBeTypeOf('function');
    expect(cjs.heartbeat).toBeTypeOf('function');
    expect(() => cjs.pulseboard({ endpoint: 'https://x.example/api/v1' })).toThrow(
      /apiKey is required/,
    );
    const fetch = vi.fn(async () => ({ ok: true, status: 202 }));
    const agent = cjs.pulseboard({
      apiKey: 'k',
      endpoint: 'https://x.example/api/v1',
      fetch,
      handleSignals: false,
    });
    await expect(agent.flush()).resolves.toBe(true);
    await agent.stop({ flush: false });
  });

  it('ships type definitions for both module systems, and imports only node: builtins', () => {
    for (const file of ['index.d.ts', 'index.d.cts']) {
      const text = readFileSync(join(root, 'dist', file), 'utf8');
      expect(text).toContain('export interface PulseboardOptions');
      expect(text).toContain('export function pulseboard');
      expect(text).toContain('export function heartbeat');
    }
    for (const file of ['index.js', 'index.cjs']) {
      const text = readFileSync(join(root, 'dist', file), 'utf8');
      const specifiers = [...text.matchAll(/(?:from\s+|require\()\s*["']([^"']+)["']/g)].map(
        (m) => m[1],
      );
      expect(specifiers.every((s) => s.startsWith('node:'))).toBe(true);
    }
  });
});

describe('package.json', () => {
  it('points every export at a file the build produces', () => {
    const { import: esm, require: cjs } = pkg.exports['.'];
    for (const file of [esm.types, esm.default, cjs.types, cjs.default, pkg.main, pkg.types]) {
      expect(existsSync(join(root, file))).toBe(true);
    }
  });

  it('has no runtime dependencies and publishes only dist, README and LICENSE', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.files).toEqual(['dist', 'README.md', 'LICENSE']);
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.peerDependenciesMeta.express.optional).toBe(true);
  });

  it('keeps AGENT_VERSION in step with the version', () => {
    expect(AGENT_VERSION).toBe(pkg.version);
  });
});

describe('the report timer', () => {
  it('is unref()ed, so it never keeps the process alive', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const agent = pulseboard({
      apiKey: 'k',
      endpoint: 'https://x.example/api/v1',
      fetch: async () => ({ ok: true }),
      handleSignals: false,
    });
    const timer = spy.mock.results[0].value;
    expect(timer.hasRef()).toBe(false);
    spy.mockRestore();
    await agent.stop({ flush: false });
  });

  it('lets a real process exit while the agent is still running', () => {
    const entry = pathToFileURL(join(root, 'src', 'index.js')).href;
    const script = [
      `import { pulseboard } from ${JSON.stringify(entry)};`,
      `pulseboard({ apiKey: 'k', endpoint: 'http://127.0.0.1:9/api/v1', handleSignals: false });`,
      `console.log('started');`,
    ].join('\n');
    const started = Date.now();
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(out.trim()).toBe('started');
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});
