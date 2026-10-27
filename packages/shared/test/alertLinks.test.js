import { describe, expect, it } from 'vitest';
import {
  alertChannelsLink,
  appBaseUrl,
  buildAlert,
  buildNotice,
  monitorLink,
  workspaceLink,
} from '../src/alerts/index.js';
import { dashboardUrlWarning } from '../src/env.js';

const CLIENT = 'https://app.pulseboard.dev';
const monitor = { _id: 'm1', workspaceId: 'w1', name: 'Checkout API', url: 'https://x.test' };
const incident = { cause: 'Timed out', startedAt: new Date(), durationSec: 60 };

describe('appBaseUrl', () => {
  it('drops trailing slashes and surrounding whitespace', () => {
    expect(appBaseUrl('https://app.example.com/')).toBe('https://app.example.com');
    expect(appBaseUrl('  https://app.example.com///\n')).toBe('https://app.example.com');
    expect(appBaseUrl('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('never throws on a missing value', () => {
    expect(appBaseUrl(undefined)).toBe('');
  });
});

describe('link builders', () => {
  it('builds workspace, monitor and alert-channel links from the client URL', () => {
    expect(workspaceLink(CLIENT, 'w1')).toBe(`${CLIENT}/app/w1`);
    expect(workspaceLink(`${CLIENT}/`, 'w1', 'usage')).toBe(`${CLIENT}/app/w1/usage`);
    expect(workspaceLink(CLIENT, 'w1', '/usage')).toBe(`${CLIENT}/app/w1/usage`);
    expect(monitorLink(CLIENT, 'w1', 'm1')).toBe(`${CLIENT}/app/w1/monitors/m1`);
    expect(alertChannelsLink(`${CLIENT}/`, 'w1')).toBe(`${CLIENT}/app/w1/alerts`);
  });
});

describe('alert links', () => {
  it('links a real down alert to the monitor page', () => {
    const alert = buildAlert({ kind: 'down', monitor, incident, dashboardUrl: `${CLIENT}/` });
    expect(alert.link).toBe(`${CLIENT}/app/w1/monitors/m1`);
  });

  it('links a recovery alert to the monitor page, using id when _id is absent', () => {
    const alert = buildAlert({
      kind: 'up',
      monitor: { id: 'm9', workspaceId: 'w1', name: 'API' },
      incident,
      dashboardUrl: CLIENT,
    });
    expect(alert.link).toBe(`${CLIENT}/app/w1/monitors/m9`);
  });

  it('links a test alert to the Alert channels page, never to a monitor', () => {
    const alert = buildAlert({
      kind: 'test',
      workspaceId: 'w1',
      monitor: { name: 'Test monitor', url: 'https://example.com' },
      dashboardUrl: CLIENT,
    });
    expect(alert.link).toBe(`${CLIENT}/app/w1/alerts`);
    expect(alert.link).not.toContain('/monitors/');
  });

  it('falls back to the monitor workspace for a test alert without an explicit workspaceId', () => {
    const alert = buildAlert({ kind: 'test', monitor, dashboardUrl: CLIENT });
    expect(alert.link).toBe(`${CLIENT}/app/w1/alerts`);
  });

  it('links notices (budget, silent agent) to the monitor page', () => {
    const notice = buildNotice({
      noticeKind: 'budget_warning',
      monitor,
      details: { requests: 800, budget: 1000, month: '2026-10' },
      dashboardUrl: `${CLIENT}/`,
    });
    expect(notice.link).toBe(`${CLIENT}/app/w1/monitors/m1`);
  });
});

describe('dashboardUrlWarning', () => {
  const env = (overrides) => ({ NODE_ENV: 'production', DASHBOARD_URL: CLIENT, ...overrides });

  it('is quiet for a public URL in production', () => {
    expect(dashboardUrlWarning(env())).toBeNull();
  });

  it('warns when production links would point at the local machine', () => {
    expect(dashboardUrlWarning(env({ DASHBOARD_URL: 'http://localhost:5173' }))).toMatch(
      /DASHBOARD_URL points at localhost/,
    );
    expect(dashboardUrlWarning(env({ DASHBOARD_URL: 'http://127.0.0.1:5173' }))).toMatch(
      /127\.0\.0\.1/,
    );
    expect(dashboardUrlWarning(env({ DASHBOARD_URL: 'http://[::1]:5173' }))).toMatch(/::1/);
  });

  it('warns about an unparseable URL, and stays quiet outside production', () => {
    expect(dashboardUrlWarning(env({ DASHBOARD_URL: 'not a url' }))).toMatch(/not a valid URL/);
    expect(
      dashboardUrlWarning(env({ NODE_ENV: 'development', DASHBOARD_URL: 'http://localhost:5173' })),
    ).toBeNull();
  });
});
