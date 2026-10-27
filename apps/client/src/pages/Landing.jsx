import { Link } from 'react-router-dom';
import TickGauge from '../components/gauge/TickGauge.jsx';
import PublicHeader from '../components/public/PublicHeader.jsx';
import SignalFieldLazy from '../components/signal/SignalFieldLazy.jsx';
import Card from '../components/ui/Card.jsx';
import RingDotCta from '../components/ui/RingDotCta.jsx';
import SteppedCards from '../components/ui/SteppedCards.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useDemoSignal } from '../hooks/useSignalFeed.js';

const KEY_NUMBERS = [
  {
    value: 3,
    unit: 'checks',
    label: 'To confirm an outage',
    description:
      'Down after 3 failed checks, up after 2 good ones. A single blip never pages anyone.',
  },
  {
    value: 90,
    unit: 'days',
    label: 'Of public uptime history',
    description: 'A calm status page for your customers, with incident history and no login.',
  },
  {
    value: 0,
    unit: 'requests',
    label: 'Sent by push monitors',
    description: 'Heartbeats and agents report in, so paid endpoints are never polled.',
  },
];

const MODES = [
  {
    n: '01',
    title: 'Push: they tell us',
    text: 'Heartbeat and agent monitors report in on their own schedule. We send nothing to your servers, and silence is the signal.',
  },
  {
    n: '02',
    title: 'Pull: we ask',
    text: 'HTTP checks call your endpoint on an interval. When a push monitor goes quiet, we probe it once as the fallback before raising an incident.',
  },
];

export default function Landing() {
  useDocumentTitle('Uptime monitoring');
  const signal = useDemoSignal();

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />

      <main className="flex-1">
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pt-16 pb-24 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:pt-24">
          <div>
            <h1
              className="animate-rise font-light tracking-[-0.03em] text-fg"
              style={{ fontSize: 'clamp(44px, 7vw, 96px)', lineHeight: 1.02, '--i': 0 }}
            >
              Know before
              <br />
              they do.
            </h1>
            <p
              className="animate-rise mt-6 max-w-[34ch] text-[15px] leading-relaxed text-muted"
              style={{ '--i': 1 }}
            >
              Quiet until it matters.
            </p>
            <div className="animate-rise mt-12" style={{ '--i': 2 }}>
              <RingDotCta to="/register">Start monitoring</RingDotCta>
            </div>
          </div>

          <div
            className="animate-rise grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 xl:gap-4"
            style={{ '--i': 2 }}
          >
            <TickGauge
              value={99.98}
              decimals={2}
              size={260}
              label="Average uptime"
              caption="across monitors"
              ariaLabel="99.98 percent average uptime across monitors"
            />
            <TickGauge
              value={97}
              decimals={0}
              size={260}
              label="Fewer requests"
              caption="than polling"
              ariaLabel="97 percent fewer requests than polling (illustrative)"
            />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8" aria-label="Key numbers">
          <div className="mb-10 flex flex-wrap items-baseline justify-between gap-x-10 gap-y-3">
            <h2 className="text-[clamp(32px,4.5vw,56px)] leading-[1.05] font-light tracking-[-0.03em]">
              Built to stay quiet
            </h2>
            <p className="max-w-[38ch] text-sm text-muted">
              Fewer false alarms, less traffic to your servers, and a page your customers can read
              at a glance.
            </p>
          </div>
          <SteppedCards items={KEY_NUMBERS} />
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8" aria-label="How monitoring works">
          <div className="grid gap-5 md:grid-cols-2">
            {MODES.map((mode, i) => (
              <Card
                key={mode.n}
                interactive
                className="animate-rise flex min-h-[260px] flex-col justify-between gap-12 p-7"
                style={{ '--i': i }}
              >
                <span className="text-[40px] font-light tracking-[-0.03em] text-faint">
                  {mode.n}
                </span>
                <div>
                  <h3 className="text-xl font-light tracking-[-0.02em] text-fg">{mode.title}</h3>
                  <p className="mt-3 max-w-[38ch] text-sm leading-relaxed text-muted">
                    {mode.text}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <section className="relative" aria-label="Live signal">
          <SignalFieldLazy
            {...signal}
            height={320}
            ariaLabel="A flowing field of dots, a decorative signal"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto flex max-w-6xl justify-between px-5 text-[11px] text-faint sm:px-8">
            <span>Checks every 60s</span>
            <span>Live ↗</span>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-[11px] text-faint sm:px-8">
        <span>PulseBoard</span>
        <Link to="/status/acme" className="transition-colors duration-200 hover:text-fg">
          See a live status page
        </Link>
      </footer>
    </div>
  );
}
