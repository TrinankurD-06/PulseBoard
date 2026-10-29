import { ROLES } from '@pulseboard/shared/constants';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useGithubCandidates, useImportFromGithub } from '../api/github.js';
import { errorMessage } from '../api/http.js';
import { useStatusPages } from '../api/statusPages.js';
import CandidateSkeleton from '../components/github/CandidateSkeleton.jsx';
import GithubErrorPanel from '../components/github/GithubErrorPanel.jsx';
import ImportResult from '../components/github/ImportResult.jsx';
import RepoGroup from '../components/github/RepoGroup.jsx';
import StatusPageOption from '../components/github/StatusPageOption.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import Switch from '../components/ui/Switch.jsx';
import { useCurrentWorkspace } from '../hooks/useCurrentWorkspace.js';
import {
  buildImportBody,
  countCandidates,
  defaultSelection,
  groupRepos,
  importLabel,
  isOverLimit,
  MAX_IMPORT_URLS,
  selectAllState,
  selectedUrls,
  toggleRepo,
  toggleSelectAll,
  toggleUrl,
} from '../lib/githubImport.js';

export default function GithubImport() {
  const { wid, can } = useCurrentWorkspace();
  const canEdit = can(ROLES.MEMBER);
  const [forks, setForks] = useState(false);
  // null until the user ticks something: the default selection follows the data.
  const [picked, setPicked] = useState(null);
  const [statusPage, setStatusPage] = useState(null);
  const [result, setResult] = useState(null);

  const query = useGithubCandidates(wid, { forks, enabled: canEdit });
  const { data: pages } = useStatusPages(wid);
  const importer = useImportFromGithub(wid);

  const repos = useMemo(() => groupRepos(query.data?.repos), [query.data]);
  const selected = useMemo(() => picked ?? defaultSelection(repos), [picked, repos]);
  const urls = selectedUrls(selected, repos);
  const allState = selectAllState(selected, repos);
  const counts = countCandidates(repos);
  const overLimit = isOverLimit(urls.length);

  const header = (
    <PageHeader
      title="Import from GitHub"
      phrase={
        query.data?.githubLogin
          ? `Sites found in the public repos of @${query.data.githubLogin}`
          : 'Find the sites in your public repos and monitor them'
      }
    />
  );

  if (!canEdit) {
    return (
      <>
        {header}
        <EmptyState
          title="Members only"
          description="Only workspace members and above can import monitors."
          action={
            <Link to={`/app/${wid}`} className="text-sm text-fg underline underline-offset-4">
              Back to the dashboard
            </Link>
          }
        />
      </>
    );
  }

  if (result) {
    return (
      <>
        {header}
        <ImportResult
          result={result}
          wid={wid}
          onImportMore={() => {
            setResult(null);
            setPicked(null);
            setStatusPage(null);
          }}
        />
      </>
    );
  }

  const changeForks = (value) => {
    setForks(value);
    setPicked(null);
  };

  const submit = async () => {
    try {
      const data = await importer.mutateAsync(buildImportBody(urls, statusPage));
      setResult(data);
      if (data.created?.length) toast.success(`${data.created.length} monitors created`);
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't import those sites. Please try again."));
    }
  };

  const refresh = async () => {
    setPicked(null);
    await query.refetch();
  };

  return (
    <>
      {header}

      {query.isError && (
        <GithubErrorPanel
          error={query.error}
          wid={wid}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      )}

      {query.isPending && <CandidateSkeleton />}

      {query.data && (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <label
              htmlFor="select-all-github"
              className="flex cursor-pointer items-center gap-3 text-sm text-fg"
            >
              <input
                id="select-all-github"
                ref={(el) => {
                  if (el) el.indeterminate = allState === 'some';
                }}
                type="checkbox"
                checked={allState === 'all'}
                disabled={allState === 'none' && counts.total === counts.monitored}
                onChange={() => setPicked(toggleSelectAll(selected, repos))}
                className="h-4 w-4 cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-40"
              />
              Select all
            </label>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-2.5 text-sm text-muted">
                <Switch checked={forks} onChange={changeForks} label="Include forks" />
                <span>Include forks</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={refresh}
                loading={query.isFetching}
                aria-label="Refresh from GitHub"
              >
                {!query.isFetching && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                Refresh
              </Button>
            </div>
          </div>

          {query.data.rateLimit && query.data.rateLimit.remaining < 10 && (
            <p className="mb-4 text-xs text-status-degraded">
              GitHub requests left this hour: {query.data.rateLimit.remaining}.
            </p>
          )}

          {repos.length === 0 ? (
            <EmptyState
              title="No live sites found in your public repos"
              description={
                forks
                  ? 'We looked at deployments, homepages, Pages and README links and found nothing to monitor.'
                  : 'Forks are left out. Turn on "Include forks" to look at those too.'
              }
            />
          ) : (
            <div className={query.isFetching ? 'space-y-4 opacity-60' : 'space-y-4'}>
              {repos.map((repo) => (
                <RepoGroup
                  key={repo.repo}
                  repo={repo}
                  selected={selected}
                  wid={wid}
                  onToggle={(url) => setPicked(toggleUrl(selected, url))}
                  onToggleRepo={(r) => setPicked(toggleRepo(selected, r))}
                />
              ))}
            </div>
          )}

          {repos.length > 0 && (
            <div className="sticky bottom-0 z-10 mt-8 -mx-1 border-t border-line bg-bg px-1 py-4">
              <StatusPageOption
                value={statusPage}
                onChange={setStatusPage}
                pages={pages ?? []}
                disabled={importer.isPending}
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted" aria-live="polite">
                  {overLimit
                    ? `Select at most ${MAX_IMPORT_URLS} sites per import (${urls.length} selected).`
                    : `${urls.length} of ${counts.total - counts.monitored} selected`}
                </p>
                <Button
                  onClick={submit}
                  loading={importer.isPending}
                  disabled={urls.length === 0 || overLimit}
                >
                  {importLabel(urls.length)}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
