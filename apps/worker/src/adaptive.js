import {
  effectiveIntervalSec,
  nextInterval,
  updateResponseEwma,
} from '@pulseboard/shared/adaptive';
import { Monitor } from '@pulseboard/shared/models';
import { applyIntervalToRunningJob } from '@pulseboard/shared/scheduling';

/**
 * After a check: decide the next interval and apply it to the RUNNING job.
 * `monitor` is the state the incident engine just wrote (status and counters
 * updated). Also maintains the response-time average used for spike
 * detection; failed checks are left out of the average (their timings say
 * nothing about normal speed).
 * Returns the interval now in use.
 */
export async function applyAdaptiveInterval({ job, db, monitor, result, checkedAt, logger }) {
  const next = nextInterval(monitor, result, checkedAt);
  const current = effectiveIntervalSec(monitor);
  const updates = {};

  if (monitor.adaptive && result.ok && result.totalMs != null) {
    updates.responseEwmaMs = updateResponseEwma(
      monitor.responseEwmaMs,
      monitor.responseEwmaAt,
      result.totalMs,
      checkedAt,
    );
    updates.responseEwmaAt = checkedAt;
  }

  if (next !== current) updates.currentIntervalSec = next;
  // Compare with the JOB's real interval too, not only the monitor's: if the
  // two ever drift apart (e.g. a write that didn't land), the next run fixes it.
  if (next !== current || job.attrs.repeatInterval !== `${next} seconds`) {
    const matched = await applyIntervalToRunningJob(job, db, next);
    if (!matched)
      logger?.warn({ monitorId: monitor._id }, 'Check job not found to update its interval');
  }

  if (Object.keys(updates).length > 0) {
    // isPaused: false so a monitor paused mid-check isn't touched.
    await Monitor.updateOne({ _id: monitor._id, isPaused: false }, { $set: updates });
  }
  return next;
}
