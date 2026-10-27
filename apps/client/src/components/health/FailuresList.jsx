/** Failed checks in the selected range (newest first): time, mono code, message. */
export default function FailuresList({ failures }) {
  return (
    <div className="mt-5">
      <h4 className="text-xs text-faint">Failed checks</h4>
      {failures.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No failed checks in this range.</p>
      ) : (
        <ul className="mt-2 max-h-64 divide-y divide-line overflow-auto rounded-card border border-line">
          {failures.map((f, i) => (
            <li
              key={`${f.t}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]"
            >
              <time className="shrink-0 font-mono text-[11px] text-faint" dateTime={f.t}>
                {new Date(f.t).toLocaleString()}
              </time>
              {f.code && (
                <span className="shrink-0 rounded-pill border border-line px-2 font-mono text-[11px] text-fg">
                  {f.code}
                </span>
              )}
              <span className="min-w-0 break-words text-muted">{f.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
