import { oauthStartUrl } from '../../api/oauth.js';
import { githubErrorInfo } from '../../lib/githubImport.js';
import Button, { primaryButtonClasses } from '../ui/Button.jsx';
import { cn } from '../../lib/cn.js';

/** Error state for the candidate list: a plain message and the one thing to do next. */
export default function GithubErrorPanel({ error, wid, onRetry, retrying }) {
  const info = githubErrorInfo(error);
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-4 rounded-card border border-status-down/50 px-6 py-8"
    >
      <div>
        <h2 className="text-xl font-light tracking-[-0.02em] text-fg">{info.title}</h2>
        <p className="mt-2 max-w-[56ch] text-sm text-muted">{info.message}</p>
      </div>
      {info.action === 'signin' && (
        <a
          href={oauthStartUrl('github', `/app/${wid}/import/github`)}
          className={cn(
            primaryButtonClasses,
            'inline-flex h-10 items-center rounded-pill px-5 text-sm font-medium',
          )}
        >
          Sign in with GitHub
        </a>
      )}
      {info.action === 'retry' && (
        <Button variant="secondary" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      )}
    </div>
  );
}
