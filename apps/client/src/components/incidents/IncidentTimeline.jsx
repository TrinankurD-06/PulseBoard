import { AlertTriangle, CheckCircle2, Send, XCircle } from 'lucide-react';
import { Fragment } from 'react';

const EVENT_STYLE = {
  opened: { icon: AlertTriangle, color: 'text-red-500' },
  alert_sent: { icon: Send, color: 'text-sky-500' },
  alert_failed: { icon: XCircle, color: 'text-amber-500' },
  resolved: { icon: CheckCircle2, color: 'text-emerald-500' },
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
        className="text-emerald-600 underline dark:text-emerald-400"
      >
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export default function IncidentTimeline({ events }) {
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-6 dark:border-slate-800">
      {events.map((event, i) => {
        const { icon: Icon, color } = EVENT_STYLE[event.type] ?? EVENT_STYLE.opened;
        return (
          <li key={i} className="relative">
            <span className="absolute top-0.5 -left-[33px] flex h-5 w-5 items-center justify-center rounded-full bg-white dark:bg-slate-950">
              <Icon className={`h-4 w-4 ${color}`} aria-hidden="true" />
            </span>
            <p className="text-sm break-words">
              <Linkified text={event.message ?? event.type} />
            </p>
            <time className="text-xs text-slate-500" dateTime={event.at}>
              {new Date(event.at).toLocaleString()}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
