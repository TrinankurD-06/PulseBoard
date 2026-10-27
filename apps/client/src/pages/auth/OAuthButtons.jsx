import { oauthStartUrl, useOAuthProviders } from '../../api/oauth.js';
import RingDot from '../../components/ui/RingDot.jsx';

/**
 * "Continue with …" for each provider the server has configured, as hairline
 * pills, then an "or" divider. Renders nothing while loading or when no
 * provider is configured. `next` is the app path to land on after signing in.
 */
export default function OAuthButtons({ next = '/app' }) {
  const { data: providers = [] } = useOAuthProviders();
  if (providers.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="space-y-2.5">
        {providers.map((provider) => (
          // A plain link: sign-in leaves the app for the provider's consent screen.
          <a
            key={provider.id}
            href={oauthStartUrl(provider.id, next)}
            className="flex h-10 w-full items-center justify-center gap-2.5 rounded-pill border border-line-strong text-sm text-fg transition-colors duration-200 ease-(--ease) hover:border-fg hover:bg-surface-2"
          >
            <RingDot size={14} />
            Continue with {provider.name}
          </a>
        ))}
      </div>
      <div className="mt-8 flex items-center gap-3 text-[11px] text-faint">
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        or
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </div>
    </div>
  );
}
