import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

// The block for a theme: ':root {' for dark, ":root[data-theme='light'] {" for light.
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const channel = (v) => {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const dark = tokens(':root');
const light = tokens(":root[data-theme='light']");

describe('theme tokens', () => {
  it('the light theme overrides every colour token the dark theme defines', () => {
    const colourTokens = Object.keys(dark).filter((name) =>
      /^(bg|surface|line|text|accent|glow|status|field|series)/.test(name),
    );
    for (const name of colourTokens) expect(light, name).toHaveProperty(name);
  });

  for (const [name, theme] of [
    ['dark', dark],
    ['light', light],
  ]) {
    describe(name, () => {
      it.each([
        'text',
        'text-muted',
        'text-faint',
        'accent',
        'status-up',
        'status-down',
        'status-degraded',
        'series',
      ])('%s reads at 4.5:1 on the page', (token) => {
        expect(contrast(theme[token], theme.bg)).toBeGreaterThanOrEqual(4.5);
      });
      it('filled accent buttons keep their text readable', () => {
        expect(contrast(theme['accent-ink'], theme.accent)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }
});
