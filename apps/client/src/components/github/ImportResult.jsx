import { Link } from 'react-router-dom';
import { skipReason } from '../../lib/githubImport.js';
import Button from '../ui/Button.jsx';
import Card from '../ui/Card.jsx';
import RingDotCta from '../ui/RingDotCta.jsx';

/** Shown after an import: what was created, what was skipped and why, where to go next. */
export default function ImportResult({ result, wid, onImportMore }) {
  const created = result.created ?? [];
  const skipped = result.skipped ?? [];
  const page = result.statusPage;

  return (
    <div className="space-y-6" role="status">
      <Card className="p-6">
        <h2 className="text-2xl font-light tracking-[-0.02em] text-fg">
          {created.length === 0
            ? 'Nothing was imported'
            : `${created.length} monitor${created.length === 1 ? '' : 's'} created`}
        </h2>
        {page && (
          <p className="mt-2 text-sm text-muted">
            {page.added} added to the status page{' '}
            <Link
              to={`/app/${wid}/status-pages`}
              className="text-fg underline decoration-line-strong underline-offset-4"
            >
              {page.title}
            </Link>
            .
          </p>
        )}
        {created.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {created.map((monitor) => (
              <li key={monitor.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <Link
                  to={`/app/${wid}/monitors/${monitor.id}`}
                  className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
                >
                  {monitor.name}
                </Link>
                <span className="font-mono text-xs break-all text-muted">{monitor.url}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {skipped.length > 0 && (
        <Card className="p-6">
          <h3 className="font-medium text-fg">{skipped.length} skipped</h3>
          <ul className="mt-3 divide-y divide-line">
            {skipped.map((item) => (
              <li
                key={item.url}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
              >
                <span className="font-mono text-xs break-all text-muted">{item.url}</span>
                <span className="text-muted">{skipReason(item.reason)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-6">
        <RingDotCta to={`/app/${wid}`}>Go to dashboard</RingDotCta>
        <Button variant="ghost" onClick={onImportMore}>
          Import more
        </Button>
      </div>
    </div>
  );
}
