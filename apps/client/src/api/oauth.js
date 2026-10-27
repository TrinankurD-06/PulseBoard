import { useQuery } from '@tanstack/react-query';
import { http } from './http.js';

/**
 * Sign-in providers configured on the server: [{ id, name }]. Empty when none
 * are, and also when the server doesn't offer OAuth at all (an older API
 * answers 404): the login page then simply shows no provider buttons.
 */
export function useOAuthProviders() {
  return useQuery({
    queryKey: ['oauth', 'providers'],
    queryFn: () =>
      http
        .get('/auth/oauth/providers')
        .then((res) => res.data.data ?? [])
        .catch(() => []),
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * Where "Continue with …" sends the browser. A full-page navigation, not a
 * request: the provider's consent screen can't load inside an XHR.
 */
export function oauthStartUrl(providerId, next) {
  return http.getUri({
    url: `/auth/oauth/${encodeURIComponent(providerId)}/start`,
    params: next ? { next } : undefined,
  });
}
