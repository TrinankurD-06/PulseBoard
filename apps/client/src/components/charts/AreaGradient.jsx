import { AREA_BOTTOM, AREA_TOP } from './chartTheme.js';

/** Vertical wash for area fills: --text at 10% fading to transparent. Goes inside <defs>. */
export default function AreaGradient({ id, userSpace }) {
  const props = userSpace
    ? { gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: userSpace.top, y2: userSpace.bottom }
    : { x1: 0, x2: 0, y1: 0, y2: 1 };
  return (
    <linearGradient id={id} {...props}>
      <stop offset="0" style={{ stopColor: AREA_TOP }} />
      <stop offset="1" style={{ stopColor: AREA_BOTTOM }} />
    </linearGradient>
  );
}
