import { describe, expect, it } from 'vitest';
import { decideTransition, nextMonitorState, TRANSITIONS } from '../src/incident/stateMachine.js';

const fresh = (status = 'pending') => ({ status, consecutiveFailures: 0, consecutiveSuccesses: 0 });

/** Feeds a sequence like "✓✓✗✗✗" through the machine; returns final state + transitions. */
function run(sequence, start = fresh()) {
  let state = start;
  const transitions = [];
  for (const symbol of sequence) {
    state = nextMonitorState(state, symbol === '✓');
    if (state.transition) transitions.push(state.transition);
  }
  return { status: state.status, transitions, state };
}

describe('incident state machine', () => {
  it('pending -> up on the first successful check, without an incident', () => {
    expect(run('✓')).toMatchObject({ status: 'up', transitions: [TRANSITIONS.MARK_UP] });
  });

  it('stays up through 1 or 2 failures', () => {
    expect(run('✓✗✗')).toMatchObject({ status: 'up', transitions: [TRANSITIONS.MARK_UP] });
  });

  it('opens an incident on the 3rd consecutive failure', () => {
    const result = run('✓✗✗✗');
    expect(result.status).toBe('down');
    expect(result.transitions).toEqual([TRANSITIONS.MARK_UP, TRANSITIONS.OPEN_INCIDENT]);
  });

  it('goes straight from pending to down if the first 3 checks fail', () => {
    expect(run('✗✗✗')).toMatchObject({
      status: 'down',
      transitions: [TRANSITIONS.OPEN_INCIDENT],
    });
  });

  it('opens only ONE incident however long the outage lasts', () => {
    const result = run('✗✗✗✗✗✗✗✗✗✗');
    expect(result.transitions).toEqual([TRANSITIONS.OPEN_INCIDENT]);
    expect(result.state.consecutiveFailures).toBe(10);
  });

  it('stays down after a single success', () => {
    expect(run('✗✗✗✓').status).toBe('down');
  });

  it('resolves after 2 consecutive successes', () => {
    expect(run('✗✗✗✓✓')).toMatchObject({
      status: 'up',
      transitions: [TRANSITIONS.OPEN_INCIDENT, TRANSITIONS.RESOLVE_INCIDENT],
    });
  });

  it('a failure in the middle of recovery restarts the recovery count', () => {
    const result = run('✗✗✗✓✗✓');
    expect(result.status).toBe('down');
    expect(result.transitions).toEqual([TRANSITIONS.OPEN_INCIDENT]);
    expect(run('✗✗✗✓✗✓✓').status).toBe('up');
  });

  it('flapping (never 3 failures in a row) never opens an incident', () => {
    expect(run('✓✗✓✗✗✓✗✓✗✗✓✗')).toMatchObject({
      status: 'up',
      transitions: [TRANSITIONS.MARK_UP],
    });
  });

  it('flapping while down never resolves it (never 2 successes in a row)', () => {
    expect(run('✗✗✗✓✗✓✗✓✗')).toMatchObject({
      status: 'down',
      transitions: [TRANSITIONS.OPEN_INCIDENT],
    });
  });

  it('handles repeated outage cycles: one open + one resolve each', () => {
    expect(run('✓✗✗✗✓✓✗✗✗✓✓').transitions).toEqual([
      TRANSITIONS.MARK_UP,
      TRANSITIONS.OPEN_INCIDENT,
      TRANSITIONS.RESOLVE_INCIDENT,
      TRANSITIONS.OPEN_INCIDENT,
      TRANSITIONS.RESOLVE_INCIDENT,
    ]);
  });

  it('ignores checks while paused', () => {
    const paused = { status: 'paused', consecutiveFailures: 5, consecutiveSuccesses: 0 };
    expect(nextMonitorState(paused, false)).toEqual({ ...paused, transition: null });
    expect(decideTransition({ ...paused, consecutiveFailures: 99 })).toBeNull();
  });

  it('counts successes and failures, each resetting the other', () => {
    expect(run('✗✗✓').state).toMatchObject({ consecutiveFailures: 0, consecutiveSuccesses: 1 });
    expect(run('✓✓✗').state).toMatchObject({ consecutiveFailures: 1, consecutiveSuccesses: 0 });
  });
});
