import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn.js';
import { redirectTarget, sourceLabel, statusInfo } from '../../lib/githubImport.js';
import Badge from '../ui/Badge.jsx';

/** One site found in a repo: checkbox, URL, where we found it and whether it answers. */
export default function CandidateRow({ candidate, checked, onToggle, wid }) {
  const { label, tone } = statusInfo(candidate.status);
  const target = redirectTarget(candidate);
  const monitored = candidate.monitored;

  return (
    <li className="flex items-start gap-3 border-t border-line px-5 py-3 first:border-t-0">
      <input
        type="checkbox"
        checked={monitored ? false : checked}
        disabled={monitored}
        onChange={() => onToggle(candidate.url)}
        aria-label={monitored ? `${candidate.url} (already monitored)` : `Import ${candidate.url}`}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={cn('font-mono text-[13px] break-all', monitored ? 'text-faint' : 'text-fg')}
          >
            {candidate.url}
          </span>
          <span className="rounded-pill border border-line px-2 py-0.5 text-[11px] text-muted">
            {sourceLabel(candidate.source)}
          </span>
        </div>
        {target && (
          <p className="mt-1 flex items-start gap-1.5 font-mono text-xs break-all text-muted">
            <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              <span className="sr-only">Redirects to </span>
              {target}
            </span>
          </p>
        )}
      </div>
      <div className="shrink-0 pt-0.5 text-right">
        {monitored ? (
          candidate.monitorId ? (
            <Link
              to={`/app/${wid}/monitors/${candidate.monitorId}`}
              className="text-xs text-muted underline decoration-line-strong underline-offset-4 hover:text-fg"
            >
              Already monitored
            </Link>
          ) : (
            <span className="text-xs text-muted">Already monitored</span>
          )
        ) : (
          <Badge tone={tone}>
            {label}
            {candidate.statusCode ? (
              <span className="text-faint"> · {candidate.statusCode}</span>
            ) : null}
          </Badge>
        )}
      </div>
    </li>
  );
}
