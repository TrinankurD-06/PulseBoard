import { describe, expect, it } from 'vitest';
import {
  monitorToggle,
  resultMessage,
  stopConfirmation,
  userTags,
  workspaceLabel,
} from './admin.js';

const counts = (over) => ({ total: 4, running: 4, paused: 0, stoppedByAdmin: 0, down: 0, ...over });

describe('monitorToggle: the one button', () => {
  it('stops when anything is running', () => {
    expect(monitorToggle(counts())).toMatchObject({ action: 'stop', label: 'Stop monitors' });
    expect(monitorToggle(counts({ running: 3, paused: 1 }))).toMatchObject({
      action: 'stop',
      label: 'Stop 3 running',
    });
  });

  it('starts only what the admin stopped, once nothing is running', () => {
    const all = monitorToggle(counts({ running: 0, stoppedByAdmin: 4 }));
    expect(all).toMatchObject({ action: 'start', label: 'Start monitors' });
    const some = monitorToggle(counts({ running: 0, stoppedByAdmin: 2, paused: 2 }));
    expect(some).toMatchObject({ action: 'start', label: 'Start 2 stopped' });
    expect(some.hint).toMatch(/user paused stay paused/);
  });

  it('does nothing when there are no monitors or the user paused them all', () => {
    expect(monitorToggle(counts({ total: 0, running: 0 }))).toMatchObject({ action: null });
    expect(monitorToggle(counts({ running: 0, paused: 4 }))).toMatchObject({
      action: null,
      label: 'Paused by the user',
    });
    expect(monitorToggle(undefined)).toMatchObject({ action: null });
  });

  it('uses singular and plural correctly in its hints', () => {
    expect(monitorToggle(counts({ total: 1, running: 1 })).hint).toContain('1 running monitor.');
    expect(monitorToggle(counts({ total: 2, running: 2 })).hint).toContain('2 running monitors.');
  });
});

describe('wording', () => {
  it('words the outcome, naming anything that failed', () => {
    expect(resultMessage('stop', { changed: 1, failed: [] })).toBe('Stopped 1 monitor');
    expect(resultMessage('start', { changed: 3, failed: [] })).toBe('Started 3 monitors');
    expect(
      resultMessage('start', { changed: 1, failed: [{ name: 'Shop', reason: 'budget' }] }),
    ).toBe('Started 1 monitor; 1 failed (Shop)');
  });

  it('asks before stopping, saying who can undo it', () => {
    const text = stopConfirmation({ name: 'Alice', monitors: { running: 2 } });
    expect(text).toContain('Stop 2 running monitors of Alice');
    expect(text).toContain('only you can');
  });

  it('labels workspaces and tags users', () => {
    expect(workspaceLabel({ name: 'Acme', role: 'owner', managed: true })).toBe('Acme · owner');
    expect(workspaceLabel({ name: 'Acme', role: 'member', managed: false })).toBe(
      'Acme · member (not managed)',
    );
    expect(userTags({ isDemo: true, providers: ['github', 'google'] })).toEqual([
      'Demo',
      'GitHub',
      'Google',
    ]);
    expect(userTags({ isDemo: false })).toEqual([]);
  });
});
