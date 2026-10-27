import { oauthStartUrl, useOAuthProviders } from '../../api/oauth.js';

/** A neutral monogram, not the provider's logo (no brand assets in the app). */
function ProviderMark({ name }) {
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-slate-900 text-[11px] font-bold text-white dark:bg-slate-100 dark:text-slate-900"
      aria-hidden="true"
    >
      {name.charAt(0)}
    </span>
  );
}

/**
 * "Continue with …" for each provider the server has configured, then an "or"
 * divider. Renders nothing while loading or when no provider is configured.
 * `next` is the app path to land on after signing in.
 */
export default function OAuthButtons({ next = '/app' }) {
  const { data: providers = [] } = useOAuthProviders();
  if (providers.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="space-y-2">
        {providers.map((provider) => (
          // A plain link: sign-in leaves the app for the provider's consent screen.
          <a
            key={provider.id}
            href={oauthStartUrl(provider.id, next)}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <ProviderMark name={provider.name} />
            Continue with {provider.name}
          </a>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-3 text-xs text-slate-500">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
        or
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" aria-hidden="true" />
      </div>
    </div>
  );
}
