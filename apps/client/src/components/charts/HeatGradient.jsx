import { heatStops } from './heat.js';

/**
 * Vertical yellow → red gradient (bottom → top) for a line or area. `from` and
 * `to` are where the shape's bottom and top edges sit on the ramp (value /
 * chart top), so colour follows the value. `fade` makes it an area fill that is
 * strongest at the top and almost clear at the baseline. `userSpace` ({ bottom,
 * top } in SVG units) pins the gradient to the plot instead of the shape.
 */
export default function HeatGradient({ id, from = 0, to = 1, fade = false, userSpace }) {
  const stops = heatStops(from, to);
  return (
    <linearGradient
      id={id}
      x1="0"
      x2="0"
      {...(userSpace
        ? { gradientUnits: 'userSpaceOnUse', y1: userSpace.bottom, y2: userSpace.top }
        : { y1: '1', y2: '0' })}
    >
      {stops.map((stop) => (
        <stop
          key={stop.offset}
          offset={stop.offset}
          style={{
            stopColor: stop.color,
            stopOpacity: fade ? 0.04 + stop.offset * 0.26 : 1,
          }}
        />
      ))}
    </linearGradient>
  );
}
