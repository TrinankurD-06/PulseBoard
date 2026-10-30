import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  accountStatus,
  actionLabel,
  alertFailuresTotal,
  alertRows,
  alertsSinceText,
  auditSummaryText,
  buildQuery,
  bulkResultMessage,
  changeStreamsState,
  checksPerDayRows,
  cleanParams,
  dateRangeParams,
  errorLine,
  monitorStateLabel,
  monitorStatusRows,
  monitorTone,
  monthlyCostText,
  pageCount,
  paginationText,
  parsePage,
  protectedReason,
  providersText,
  queueState,
  savedPercent,
  selectionState,
  shortDate,
  suspendedBannerText,
  testResultMessage,
  toggleId,
  togglePage,
  typedConfirmMatches,
  workerState,
} from './adminConsole.js';

describe('query strings', () => {
  it('drops blank values and sends true as "true"', () => {
    expect(
      cleanParams({ search: '  ', status: 'open', failing: true, ownerId: '', page: 2, x: null }),
    ).toEqual({ status: 'open', failing: 'true', page: 2 });
    expect(cleanParams({ failing: false })).toEqual({});
  });

  it('builds a query string without a leading ?', () => {
    expect(buildQuery({ search: ' a b ', status: 'active', page: 3, limit: 25 })).toBe(
      'search=a+b&status=active&page=3&limit=25',
    );
    expect(buildQuery({})).toBe('');
    expect(buildQuery()).toBe('');
  });

  it('keeps page 0 out of the picture: pages start at 1', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('-2')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });

  it('turns date inputs into whole-day ISO bounds and ignores bad ones', () => {
    expect(dateRangeParams({ from: '2026-10-01', to: '2026-10-02' })).toEqual({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T23:59:59.999Z',
    });
    expect(dateRangeParams({ from: 'nope', to: '' })).toEqual({
      from: undefined,
      to: undefined,
    });
    expect(dateRangeParams()).toEqual({ from: undefined, to: undefined });
  });
});

describe('typedConfirmMatches', () => {
  it('needs the exact text, case-sensitive, untrimmed', () => {
    expect(typedConfirmMatches('ada@example.com', 'ada@example.com')).toBe(true);
    expect(typedConfirmMatches('Ada@example.com', 'ada@example.com')).toBe(false);
    expect(typedConfirmMatches('ada@example.com ', 'ada@example.com')).toBe(false);
    expect(typedConfirmMatches('', 'ada@example.com')).toBe(false);
    expect(typedConfirmMatches('delete', 'DELETE')).toBe(false);
    expect(typedConfirmMatches('DELETE', 'DELETE')).toBe(true);
  });

  it('never matches when nothing is required (an empty name must not unlock the button)', () => {
    expect(typedConfirmMatches('', '')).toBe(false);
    expect(typedConfirmMatches('', undefined)).toBe(false);
  });
});

describe('pagination text', () => {
  it('counts pages, at least one', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
    expect(pageCount(101, 50)).toBe(3);
  });

  it('says which rows are shown', () => {
    expect(paginationText({ page: 1, limit: 25, total: 132 })).toBe('Showing 1–25 of 132');
    expect(paginationText({ page: 6, limit: 25, total: 132 })).toBe('Showing 126–132 of 132');
    expect(paginationText({ page: 1, limit: 25, total: 0 })).toBe('No results');
    expect(paginationText({ page: 1, limit: 25, total: 1000 })).toBe('Showing 1–25 of 1,000');
    expect(paginationText({ page: 9, limit: 25, total: 10 })).toMatch(/No results on page 9/);
  });
});

describe('audit log wording', () => {
  it('names each action in plain words', () => {
    expect(actionLabel('user.suspend')).toBe('Suspended a user');
    expect(actionLabel('workspace.view')).toBe('Viewed a workspace as an administrator');
    expect(actionLabel('monitor.bulk')).toBe('Ran a bulk action on monitors');
  });

  it('spells an unknown action out instead of hiding it', () => {
    expect(actionLabel('billing.refund_issued')).toBe('Billing refund issued');
    expect(actionLabel(undefined)).toBe('Unknown action');
  });

  it('has a label for every action the filter offers', () => {
    for (const action of AUDIT_ACTIONS) expect(actionLabel(action)).not.toMatch(/\./);
  });

  it('summarises before/after and the note on one line', () => {
    expect(auditSummaryText({ before: 'Active', after: 'Suspended', note: 'spam' })).toBe(
      'spam · Active → Suspended',
    );
    expect(auditSummaryText({ after: { paused: 3 } })).toBe('now {"paused":3}');
    expect(auditSummaryText({ before: 'a' })).toBe('was a');
    expect(auditSummaryText({})).toBe('');
    expect(auditSummaryText(null)).toBe('');
  });
});

describe('shortDate', () => {
  it('prints a UTC day, or a dash when there is none', () => {
    expect(shortDate('2026-10-12T23:30:00.000Z')).toBe('12 Oct 2026');
    expect(shortDate(null)).toBe('—');
    expect(shortDate('nope')).toBe('—');
  });
});

describe('status and tone', () => {
  it('maps suspension to a labelled status', () => {
    expect(accountStatus({ suspendedAt: null })).toMatchObject({ label: 'Active', tone: 'green' });
    expect(accountStatus({ suspendedAt: '2026-10-01T00:00:00Z' })).toMatchObject({
      label: 'Suspended',
      tone: 'red',
    });
  });

  it('says who paused a monitor, and shows an administrator pause in amber', () => {
    const paused = { status: 'paused', isPaused: true, pausedBy: 'admin' };
    expect(monitorStateLabel(paused)).toBe('Paused by an administrator');
    expect(monitorTone(paused)).toBe('amber');
    expect(monitorStateLabel({ status: 'paused', isPaused: true, pausedBy: 'user' })).toBe(
      'Paused by the owner',
    );
    expect(monitorStateLabel({ status: 'paused', isPaused: true })).toBe('Paused');
    expect(monitorTone({ status: 'paused', isPaused: true, pausedBy: 'user' })).toBe('neutral');
    expect(monitorStateLabel({ status: 'down', isPaused: false })).toBe('Down');
    expect(monitorTone({ status: 'up' })).toBe('green');
  });

  it('lists sign-in providers', () => {
    expect(providersText(['github', 'google'])).toBe('GitHub, Google');
    expect(providersText([])).toBe('Email and password');
  });

  it('protects yourself and other superadmins, with the reason', () => {
    expect(protectedReason({ id: 'u1', platformRole: 'user' }, { id: 'u1' })).toMatch(
      /own account/,
    );
    expect(protectedReason({ id: 'u2', platformRole: 'superadmin' }, { id: 'u1' })).toMatch(
      /protected/,
    );
    expect(protectedReason({ id: 'u2', platformRole: 'user' }, { id: 'u1' })).toBeNull();
    expect(protectedReason(null, { id: 'u1' })).toBeNull();
  });

  it('maps worker, queue and change-stream states', () => {
    expect(workerState('running').tone).toBe('green');
    expect(workerState('stale').tone).toBe('amber');
    expect(workerState('???').label).toBe('Unknown');
    expect(queueState({ failed: 2 })).toMatchObject({ tone: 'red', label: '2 failed' });
    expect(queueState({ failed: 0 }).tone).toBe('green');
    expect(changeStreamsState('live').tone).toBe('green');
    expect(changeStreamsState('reconnecting').tone).toBe('amber');
  });
});

describe('row selection', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('toggles one id without changing the old set', () => {
    const start = new Set(['a']);
    expect([...toggleId(start, 'b')]).toEqual(['a', 'b']);
    expect([...toggleId(start, 'a')]).toEqual([]);
    expect(start.size).toBe(1);
  });

  it('reports none / some / all for the header checkbox', () => {
    expect(selectionState(rows, new Set())).toBe('none');
    expect(selectionState(rows, new Set(['a']))).toBe('some');
    expect(selectionState(rows, new Set(['a', 'b', 'c', 'z']))).toBe('all');
    expect(selectionState([], new Set())).toBe('none');
  });

  it('selects the whole page, then clears it, keeping rows from other pages', () => {
    const picked = togglePage(rows, new Set(['other']));
    expect([...picked].sort()).toEqual(['a', 'b', 'c', 'other']);
    expect([...togglePage(rows, picked)]).toEqual(['other']);
  });
});

describe('messages', () => {
  it('words a bulk result with skipped and failed', () => {
    expect(bulkResultMessage('pause', { changed: 3, skipped: 0, failed: [] })).toBe(
      'Paused 3 monitors',
    );
    expect(bulkResultMessage('delete', { changed: 1, skipped: 2, failed: [] })).toBe(
      'Deleted 1 monitor; 2 skipped',
    );
    expect(
      bulkResultMessage('resume', { changed: 0, failed: [{ id: '1', name: 'API', reason: 'x' }] }),
    ).toBe('Resumed 0 monitors; 1 failed (API)');
  });

  it('words a test result', () => {
    expect(testResultMessage({ ok: true, statusCode: 200, totalMs: 123.4 })).toBe(
      'Check passed (HTTP 200) in 123 ms',
    );
    expect(
      testResultMessage({ ok: false, statusCode: null, totalMs: null, error: 'timeout' }),
    ).toBe('Check failed: timeout');
    expect(testResultMessage({ ok: false, statusCode: 503, totalMs: 40 })).toBe(
      'Check failed: HTTP 503 in 40 ms',
    );
    expect(testResultMessage(null)).toBe('No result');
  });

  it('words the suspended-workspace banner', () => {
    expect(suspendedBannerText({ suspendedReason: ' abuse report ' })).toBe(
      'This workspace is suspended: abuse report',
    );
    expect(suspendedBannerText({})).toBe('This workspace is suspended by an administrator.');
  });

  it('formats a server error line', () => {
    expect(
      errorLine({ method: 'GET', route: '/monitors/:id', status: 500, code: 'INTERNAL' }),
    ).toBe('GET /monitors/:id → 500 (INTERNAL)');
  });
});

describe('overview data', () => {
  it('says since when alerts are counted, or that history has not started', () => {
    expect(alertsSinceText('2026-10-12T08:00:00.000Z')).toBe('Since 12 Oct 2026');
    expect(alertsSinceText(null)).toBe('Alert history has not started yet.');
    expect(alertsSinceText('garbage')).toBe('Alert history has not started yet.');
  });

  it('fills every channel, zero when missing', () => {
    expect(alertRows({ email: { sent: 4, failed: 1 } })).toEqual([
      { key: 'email', label: 'Email', sent: 4, failed: 1 },
      { key: 'discord', label: 'Discord', sent: 0, failed: 0 },
      { key: 'slack', label: 'Slack', sent: 0, failed: 0 },
    ]);
    expect(alertFailuresTotal({ email: 1, discord: 2, slack: 0 })).toBe(3);
    expect(alertFailuresTotal(undefined)).toBe(0);
  });

  it('labels the daily checks', () => {
    expect(checksPerDayRows([{ date: '2026-10-03', checks: 12 }])).toEqual([
      { key: '2026-10-03', date: '2026-10-03', label: 'Oct 3', checks: 12 },
    ]);
  });

  it('orders and labels the monitor statuses with a colour token', () => {
    const rows = monitorStatusRows({ up: 5, down: 1 });
    expect(rows.map((r) => r.label)).toEqual(['Up', 'Down', 'Pending', 'Paused', 'Degraded']);
    expect(rows[0]).toMatchObject({ count: 5, color: 'var(--status-up)' });
    expect(rows[2].count).toBe(0);
  });

  it('computes how much push monitors saved', () => {
    expect(savedPercent({ requestsSent: 25, requestsSaved: 75 })).toBe(75);
    expect(savedPercent({ requestsSent: 0, requestsSaved: 0 })).toBeNull();
    expect(savedPercent(null)).toBeNull();
  });

  it('prints a monthly cost per currency', () => {
    expect(monthlyCostText([])).toBe('—');
    expect(monthlyCostText([{ currency: 'USD', amount: 12 }])).toBe('$12');
  });
});
