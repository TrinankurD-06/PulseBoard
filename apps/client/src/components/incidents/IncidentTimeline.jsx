import { Fragment } from 'react';
import RingDot from '../ui/RingDot.jsx';

// Event types differ by the colour of the ring only where it carries meaning.
const EVENT_TONE = {
  opened: 'text-status-down',
  alert_sent: 'text-muted',
  alert_failed: 'text-status-degraded',
  resolved: 'text-status-up',
};

/** Turns URLs inside a message (e.g. an email preview link) into links. */
function Linkified({ text }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="text-fg underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-fg"
      >
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** A vertical hairline with a ring-dot per event. */
export default function IncidentTimeline({ events }) {
  return (
    <ol className="relative ml-2 space-y-5 border-l border-line pl-7">
      {events.map((event, i) => (
        <li key={i} className="relative">
          <span className="absolute top-0 -left-[44px] flex h-4 w-4 items-center justify-center bg-bg">
            <RingDot size={16} className={EVENT_TONE[event.type] ?? EVENT_TONE.opened} />
          </span>
          <p className="text-sm break-words text-fg">
            <Linkified text={event.message ?? event.type} />
          </p>
          <time className="font-mono text-[11px] text-faint" dateTime={event.at}>
            {new Date(event.at).toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
  );
}
