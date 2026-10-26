import { DailyRollup } from '@pulseboard/shared/models';
import { rollupDay } from '@pulseboard/shared/rollup';
import { addDays, utcDayStart } from '@pulseboard/shared/uptime';

/**
 * `rollup` (every 15 min): refreshes today's rollups, which are still
 * changing (isFinal: false). It also finalises yesterday if the nightly job
 * hasn't, e.g. because no worker was running at 00:05, so a missed run never
 * leaves a hole in the 90-day bars.
 */
export function createRollupJob({ logger }) {
  return async function rollupJob() {
    const now = new Date();
    const today = utcDayStart(now);
    const yesterday = addDays(today, -1);

    const monitors = await rollupDay(today, { isFinal: false, now });
    if (!(await DailyRollup.exists({ date: yesterday, isFinal: true }))) {
      await rollupDay(yesterday, { isFinal: true, now });
    }
    logger.debug({ monitors }, 'Rollups refreshed');
  };
}

/**
 * `finalize-rollup` (00:05 UTC daily): computes yesterday one last time and
 * marks it final. Five minutes after midnight, so a check that started just
 * before midnight has finished and been stored.
 */
export function createFinalizeRollupJob({ logger }) {
  return async function finalizeRollupJob() {
    const now = new Date();
    const yesterday = addDays(utcDayStart(now), -1);
    const monitors = await rollupDay(yesterday, { isFinal: true, now });
    logger.info({ day: yesterday.toISOString().slice(0, 10), monitors }, 'Finalized rollups');
  };
}
