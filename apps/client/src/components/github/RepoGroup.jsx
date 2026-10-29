import { ExternalLink } from 'lucide-react';
import { isSelectable } from '../../lib/githubImport.js';
import Card from '../ui/Card.jsx';
import CandidateRow from './CandidateRow.jsx';

/** A repo and the sites found in it. The repo checkbox ticks all its selectable sites. */
export default function RepoGroup({ repo, selected, onToggle, onToggleRepo, wid }) {
  const selectable = repo.candidates.filter(isSelectable);
  const ticked = selectable.filter((candidate) => selected.has(candidate.url)).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3">
        <input
          type="checkbox"
          ref={(el) => {
            if (el) el.indeterminate = ticked > 0 && ticked < selectable.length;
          }}
          checked={selectable.length > 0 && ticked === selectable.length}
          disabled={selectable.length === 0}
          onChange={() => onToggleRepo(repo)}
          aria-label={`Select all sites in ${repo.repo}`}
          className="h-4 w-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
        />
        <h2 className="min-w-0 flex-1 truncate font-medium text-fg">{repo.repo}</h2>
        {repo.isFork && (
          <span className="rounded-pill border border-line px-2 py-0.5 text-[11px] text-muted">
            Fork
          </span>
        )}
        {repo.htmlUrl && (
          <a
            href={repo.htmlUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${repo.repo} on GitHub`}
            className="text-faint transition-colors hover:text-fg"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
      <ul className="border-t border-line">
        {repo.candidates.map((candidate) => (
          <CandidateRow
            key={candidate.url}
            candidate={candidate}
            checked={selected.has(candidate.url)}
            onToggle={onToggle}
            wid={wid}
          />
        ))}
      </ul>
    </Card>
  );
}
