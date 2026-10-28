import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../lib/ThemeContext.jsx';
import { signalLabel } from '../../lib/signal.js';
import { createCanvasField } from './canvasField.js';
import { STILL_PHASE, createSimulation, readColors } from './fieldMath.js';
import { createWebglField } from './webglField.js';

// Fades the banner out at the left, right and top edges so it melts into the
// page. Only the alpha of the gradients matters.
const EDGE_MASK = {
  maskImage:
    'linear-gradient(to right, transparent, var(--bg) 14%, var(--bg) 86%, transparent), linear-gradient(to bottom, transparent, var(--bg) 26%)',
  maskComposite: 'intersect',
  WebkitMaskImage:
    'linear-gradient(to right, transparent, var(--bg) 14%, var(--bg) 86%, transparent), linear-gradient(to bottom, transparent, var(--bg) 26%)',
  WebkitMaskComposite: 'source-in',
};

const DPR_CAP = 1.5;
const CONTEXT_RESTORE_WAIT_MS = 2500;

const regionsKey = (regions) =>
  (regions ?? []).map((r) => `${r.x0.toFixed(3)}-${r.x1.toFixed(3)}-${r.state}`).join('|');

/**
 * A generative particle wave: a perspective grid of dots flowing as a 3D wave
 * (moss to cream, nearer = brighter). amplitude and speed (0..1) shape it;
 * regions in state 'down' turn status-down and turbulent, then settle;
 * pulseRef.current.pulse(x, strength) launches a ripple. Raw WebGL, with a 2D
 * canvas fallback. Pauses off-screen and in hidden tabs; one still frame under
 * reduced motion.
 */
export default function SignalField({
  amplitude = 0.3,
  speed = 0.4,
  regions,
  pulseRef,
  height = 280,
  density = 'auto',
  className = '',
  ariaLabel,
}) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const [mode, setMode] = useState('webgl');
  const targetRef = useRef({ amplitude, speed, regions });
  const wakeRef = useRef(null);
  const engineRef = useRef(null);
  const { theme } = useTheme();
  const regionKey = regionsKey(regions);

  // Latest inputs go into a ref: changing them never rebuilds the renderer.
  useEffect(() => {
    targetRef.current = { amplitude, speed, regions };
    wakeRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amplitude, speed, regionKey]);

  // A theme change repaints with the new tokens; the renderer is kept (a WebGL
  // context cannot be recreated on the same canvas).
  useEffect(() => {
    const engine = engineRef.current;
    const host = hostRef.current;
    if (!engine || !host) return;
    const styles = getComputedStyle(host);
    engine.setColors(readColors((name) => styles.getPropertyValue(name)));
    wakeRef.current?.();
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return undefined;

    const styles = getComputedStyle(host);
    const colors = readColors((name) => styles.getPropertyValue(name));
    const engine =
      mode === 'webgl' ? createWebglField(canvas, colors) : createCanvasField(canvas, colors);
    if (!engine) {
      // No WebGL (or its shaders failed): mount the 2D fallback on a new canvas.
      if (mode !== 'webgl') return undefined;
      const fallback = window.setTimeout(() => setMode('canvas'), 0);
      return () => window.clearTimeout(fallback);
    }
    host.dataset.engine = engine.kind;
    engineRef.current = engine;

    const sim = createSimulation();
    sim.setTarget(targetRef.current);
    sim.snap();

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const opts = { cores: navigator.hardwareConcurrency ?? 8, density };
    let reduced = motion.matches;
    let onScreen = true;
    let tabVisible = document.visibilityState !== 'hidden';
    let lost = false;
    let raf = 0;
    let last = 0;
    let restoreTimer = 0;
    let sized = false;

    function drawStill() {
      if (!sized || lost) return;
      sim.setTarget(targetRef.current);
      sim.snap();
      sim.phase = STILL_PHASE;
      engine.draw(sim);
    }

    function frame(now) {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      sim.step(dt);
      engine.draw(sim);
      raf = requestAnimationFrame(frame);
    }

    // Runs the loop only while visible on screen, in a visible tab, with a
    // live context and without reduced motion.
    function sync() {
      const run = onScreen && tabVisible && !reduced && !lost && sized;
      if (run && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!run && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    function measure() {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      host.dataset.points = String(engine.resize(rect.width, rect.height, dpr, opts));
      sized = true;
      if (reduced) drawStill();
      sync();
    }

    wakeRef.current = () => {
      if (reduced) drawStill();
      else sim.setTarget(targetRef.current);
    };

    if (pulseRef) {
      pulseRef.current = {
        pulse: (x, strength) => {
          if (!reduced) sim.pulse(x, strength);
        },
      };
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(host);

    const intersection =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            onScreen = entries[entries.length - 1].isIntersecting;
            sync();
          })
        : null;
    intersection?.observe(host);

    const onVisibility = () => {
      tabVisible = document.visibilityState !== 'hidden';
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onMotion = () => {
      reduced = motion.matches;
      if (reduced) drawStill();
      sync();
    };
    motion.addEventListener('change', onMotion);

    const onLost = (event) => {
      event.preventDefault(); // lets the browser try to restore the context
      lost = true;
      sync();
      // Not restored in time: switch to the 2D fallback on a fresh canvas.
      restoreTimer = window.setTimeout(() => setMode('canvas'), CONTEXT_RESTORE_WAIT_MS);
    };
    const onRestored = () => {
      window.clearTimeout(restoreTimer);
      try {
        engine.restore();
        lost = false;
        measure();
      } catch {
        setMode('canvas');
      }
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    measure();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(restoreTimer);
      resizeObserver.disconnect();
      intersection?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motion.removeEventListener('change', onMotion);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      wakeRef.current = null;
      if (pulseRef) pulseRef.current = null;
      engineRef.current = null;
      engine.destroy();
    };
  }, [mode, density, pulseRef]);

  const label = ariaLabel ?? signalLabel(regions);

  return (
    <div
      ref={hostRef}
      className={`relative w-full ${className}`}
      style={{ height, ...EDGE_MASK }}
      data-signal-field=""
    >
      <canvas
        key={mode}
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="absolute inset-0 block h-full w-full"
      />
    </div>
  );
}
