// Pure helpers for the admin panel: what the one stop/start button does for a user, and how
// the outcome is worded. No React, so they are tested on their own.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The single button on a user's row, from their monitor counts
 * (`{ total, running, paused, stoppedByAdmin, down }`):
 *  - anything running: it stops those;
 *  - nothing running but some stopped by the admin: it starts those again;
 *  - otherwise there is nothing for it to do (no monitors, or the user paused them
 *    themselves, which an admin start does not override).
 * Returns { action: 'stop' | 'start' | null, label, hint }.
 */
export function monitorToggle(counts) {
  const { total = 0, running = 0, stoppedByAdmin = 0 } = counts ?? {};
  if (!total) return { action: null, label: 'No monitors', hint: 'This user has no monitors.' };
  if (running > 0) {
    return {
      action: 'stop',
      label: running === total ? 'Stop monitors' : `Stop ${running} running`,
      hint: `Pauses ${plural(running, 'running monitor')}. Only an administrator can start them again.`,
    };
  }
  if (stoppedByAdmin > 0) {
    return {
      action: 'start',
      label: stoppedByAdmin === total ? 'Start monitors' : `Start ${stoppedByAdmin} stopped`,
      hint: `Starts the ${plural(stoppedByAdmin, 'monitor')} you stopped. Ones the user paused stay paused.`,
    };
  }
  return {
    action: null,
    label: 'Paused by the user',
    hint: 'The user paused these themselves; an admin start does not override that.',
  };
}

/** The sentence for the toast after the button, from { changed, skipped, failed }. */
export function resultMessage(action, result) {
  const { changed = 0, failed = [] } = result ?? {};
  const verb = action === 'stop' ? 'Stopped' : 'Started';
  const base = `${verb} ${plural(changed, 'monitor')}`;
  if (!failed.length) return base;
  return `${base}; ${failed.length} failed (${failed.map((item) => item.name).join(', ')})`;
}

/** The confirmation text before stopping, so the consequence is plain. */
export function stopConfirmation(row) {
  const { running } = row.monitors;
  return `Stop ${plural(running, 'running monitor')} of ${row.name}? Checks and alerts for them stop, and ${row.name} cannot restart them: only you can.`;
}

/** "Acme Inc. · viewer", marking workspaces the buttons do not act on. */
export function workspaceLabel(workspace) {
  return `${workspace.name} · ${workspace.role}${workspace.managed ? '' : ' (not managed)'}`;
}

/** Small tags shown by a user's name. */
export function userTags(row) {
  const tags = [];
  if (row.isDemo) tags.push('Demo');
  for (const provider of row.providers ?? []) {
    tags.push(provider === 'github' ? 'GitHub' : provider === 'google' ? 'Google' : provider);
  }
  return tags;
}
