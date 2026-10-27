import { useEffect, useMemo, useRef, useState } from 'react';
import { useSparklines } from '../api/analytics.js';
import { useMonitors } from '../api/monitors.js';
import {
  amplitudeFromSparklines,
  demoSignalAt,
  pulseStrength,
  regionsFromMonitors,
  slotCenter,
  speedFromMonitors,
  statusSignal,
} from '../lib/signal.js';
import { onCheckResult } from '../realtime/checkEvents.js';

const DEMO_TICK_MS = 1500;

/**
 * Workspace pages: { amplitude, speed, regions, pulseRef } for <SignalField>,
 * from the monitors and sparklines already in the TanStack cache (no extra
 * requests beyond what the dashboard makes). Every live check:result for this
 * workspace launches a ripple at the monitor's slot.
 */
export function useSignalFeed(wid) {
  const { data: monitors } = useMonitors(wid);
  const { data: sparklines } = useSparklines(wid);
  const pulseRef = useRef(null);
  const monitorsRef = useRef(monitors);

  // Live checks replace the monitors array on every event; the field only
  // cares about status and interval, so derive from a stable key.
  const statusKey = (monitors ?? []).map((m) => `${m.id}:${m.status === 'down' ? 1 : 0}`).join('|');
  const intervalKey = (monitors ?? []).map((m) => `${m.status}:${m.intervalSec}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const regions = useMemo(() => regionsFromMonitors(monitors), [statusKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const speed = useMemo(() => speedFromMonitors(monitors), [intervalKey]);
  const amplitude = useMemo(() => amplitudeFromSparklines(sparklines), [sparklines]);

  useEffect(() => {
    monitorsRef.current = monitors;
  }, [monitors]);

  useEffect(() => {
    if (!wid) return undefined;
    return onCheckResult((event) => {
      if (event.workspaceId !== wid) return;
      const x = slotCenter(monitorsRef.current, event.monitorId);
      if (x == null) return;
      pulseRef.current?.pulse(x, pulseStrength({ ok: event.lastOk, ms: event.lastResponseMs }));
    });
  }, [wid]);

  return { amplitude, speed, regions, pulseRef };
}

/** Public status page: status only (no latency), same return shape. */
export function useStatusSignal(monitors) {
  const pulseRef = useRef(null);
  const key = (monitors ?? []).map((m) => `${m.id}:${m.status === 'down' ? 1 : 0}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const signal = useMemo(() => statusSignal(monitors), [key]);
  return { ...signal, pulseRef };
}

/**
 * Landing page: gentle synthetic motion, with an occasional ripple at a random
 * place. Static under reduced motion.
 */
export function useDemoSignal() {
  const pulseRef = useRef(null);
  const [signal, setSignal] = useState(() => demoSignalAt(0));

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const started = performance.now();
    let nextPulse = 2500;
    const timer = setInterval(() => {
      const elapsed = performance.now() - started;
      setSignal(demoSignalAt(elapsed / 1000));
      if (elapsed >= nextPulse) {
        pulseRef.current?.pulse(0.15 + Math.random() * 0.7, 0.35 + Math.random() * 0.3);
        nextPulse = elapsed + 3000 + Math.random() * 3000;
      }
    }, DEMO_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return { ...signal, regions: [], pulseRef };
}
