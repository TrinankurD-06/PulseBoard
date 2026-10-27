import { useAmbientAlert } from './ambientStore.js';

// Soft radial light, fully blurred. Positions are off-centre on purpose: the
// light seems to leak in from outside the frame.
const GLOWS = [
  {
    id: 'moss',
    className: 'glow-drift-a -bottom-[22%] -left-[14%] size-[900px]',
    background: 'radial-gradient(closest-side, var(--glow), transparent)',
  },
  {
    id: 'moss-2',
    className: 'glow-drift-b -top-[28%] left-[34%] size-[700px]',
    background: 'radial-gradient(closest-side, var(--glow-2), transparent)',
  },
];

/**
 * The page's ambient light: two drifting moss glows behind everything, plus a
 * third that fades in (slowly, at low opacity) in the "down" colour while a
 * monitor is down. Mounted once; decorative, so hidden from assistive tech.
 */
export default function AmbientGlow() {
  const alert = useAmbientAlert();
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {GLOWS.map((glow) => (
        <div
          key={glow.id}
          className={`absolute rounded-full blur-[80px] will-change-transform ${glow.className}`}
          style={{ background: glow.background }}
        />
      ))}
      <div
        className="absolute -bottom-[26%] left-[6%] size-[760px] rounded-full opacity-0 blur-[80px] transition-opacity duration-[4000ms] ease-out motion-reduce:transition-none"
        style={{
          background: 'radial-gradient(closest-side, var(--status-down), transparent)',
          opacity: alert ? 0.2 : 0,
        }}
      />
    </div>
  );
}
