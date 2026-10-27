// Every link in an alert (email, Discord, Slack) is built here from one base
// URL: the public address of the client app (DASHBOARD_URL; it is the same value
// as the CORS origin in a normal deployment). Keeping this in one place means a
// test alert, a real alert and a notice can never disagree about where "Open
// dashboard" goes.

/** The base URL without whitespace or trailing slashes ("https://app.example.com/ " -> "https://app.example.com"). */
export function appBaseUrl(dashboardUrl) {
  return String(dashboardUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/** A page inside a workspace: workspaceLink(base, 'w1', 'alerts') -> ".../app/w1/alerts". */
export function workspaceLink(dashboardUrl, workspaceId, path = '') {
  const suffix = path ? `/${String(path).replace(/^\/+/, '')}` : '';
  return `${appBaseUrl(dashboardUrl)}/app/${workspaceId}${suffix}`;
}

/** A real monitor's page. Only for alerts about a monitor that exists. */
export function monitorLink(dashboardUrl, workspaceId, monitorId) {
  return workspaceLink(dashboardUrl, workspaceId, `monitors/${monitorId}`);
}

/** The Alert channels page: where a test alert sends you (a test has no monitor). */
export function alertChannelsLink(dashboardUrl, workspaceId) {
  return workspaceLink(dashboardUrl, workspaceId, 'alerts');
}
