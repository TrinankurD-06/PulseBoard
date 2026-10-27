import { formatGaugeNumber } from '../../lib/gauge.js';
import useEnterProgress from './useEnterProgress.js';

/**
 * A number that counts up from 0 once when it mounts (800 ms, the --ease
 * curve) and then simply follows `value`. Static under reduced motion. Screen
 * readers get the final number, not the frames in between.
 */
export default function CountUp({ value, decimals, thousands = false, duration = 800, className }) {
  const progress = useEnterProgress(duration);
  const options = { decimals, thousands };
  const final = formatGaugeNumber(value, options);
  const shown =
    progress >= 1
      ? final
      : formatGaugeNumber((Number.isFinite(value) ? value : 0) * progress, options);

  return (
    <span className={className}>
      <span aria-hidden="true" className="tabular-nums">
        {shown}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
