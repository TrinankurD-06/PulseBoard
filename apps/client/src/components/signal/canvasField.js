// 2D canvas fallback of the signal field, for browsers or devices without
// WebGL. Same maths as the shader (fieldMath.fieldPoint / pointColor) with
// about a third of the points, since every dot is a CPU draw call.
import { fieldPoint, generateGrid, gridDims, pointColor, selectPointBudget } from './fieldMath.js';

const FALLBACK_SHARE = 0.35;

/** Returns { kind, points, resize, draw, restore, destroy }, or null without a 2D context. */
export function createCanvasField(canvas, initialColors) {
  let colors = initialColors;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let grid = new Float32Array(0);
  let count = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  // Fill styles are quantised and cached: building a colour string per dot per
  // frame would dominate the frame time.
  const styles = new Map();
  const point = {};
  const rgb = [0, 0, 0];

  function styleFor(alpha, color) {
    const a = Math.round(alpha * 20);
    if (a <= 0) return null;
    const r = Math.round((color[0] * 255) / 8) * 8;
    const g = Math.round((color[1] * 255) / 8) * 8;
    const b = Math.round((color[2] * 255) / 8) * 8;
    const key = ((r * 256 + g) * 256 + b) * 21 + a;
    let style = styles.get(key);
    if (!style) {
      style = `rgba(${r},${g},${b},${a / 20})`;
      styles.set(key, style);
    }
    return style;
  }

  return {
    kind: 'canvas',
    get points() {
      return count;
    },
    resize(w, h, ratio, { cores, density } = {}) {
      width = w;
      height = h;
      dpr = ratio;
      canvas.width = Math.max(1, Math.round(w * ratio));
      canvas.height = Math.max(1, Math.round(h * ratio));
      const budget = Math.round(
        selectPointBudget({ width: w, height: h, cores, density }) * FALLBACK_SHARE,
      );
      const dims = gridDims(budget, w / Math.max(1, h));
      grid = generateGrid(dims.cols, dims.rows);
      count = dims.count;
      styles.clear();
      return count;
    },
    draw(sim) {
      if (!count) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = colors.additive === false ? 'source-over' : 'lighter';
      for (let i = 0; i < count; i += 1) {
        const o = i * 3;
        fieldPoint(grid[o], grid[o + 1], grid[o + 2], sim, point);
        const style = styleFor(Math.min(1, point.alpha * 1.1), pointColor(point, colors, rgb));
        if (!style) continue;
        ctx.fillStyle = style;
        const s = point.size * 0.85; // matches the soft dot's visible core
        ctx.fillRect(point.sx * width - s / 2, point.sy * height - s / 2, s, s);
      }
    },
    setColors(next) {
      colors = next;
      styles.clear();
    },
    restore() {},
    destroy() {
      styles.clear();
      grid = new Float32Array(0);
      count = 0;
    },
  };
}
