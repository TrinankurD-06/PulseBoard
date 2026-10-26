import axios from 'axios';
import { getAccessToken, setAccessToken } from './tokenStore.js';

const baseURL = import.meta.env.VITE_API_URL || '/api/v1';

export const http = axios.create({ baseURL, withCredentials: true });

http.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise = null;

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share
 * one request: refresh tokens are single-use, so two parallel refreshes would
 * look like token theft to the server and log the user out.
 */
export function refreshAccessToken() {
  refreshPromise ??= axios
    .post(`${baseURL}/auth/refresh`, null, { withCredentials: true })
    .then((res) => {
      setAccessToken(res.data.data.accessToken);
      return res.data.data.accessToken;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

let onSessionExpired = () => {};

/** AuthProvider registers what to do when the session can't be refreshed. */
export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}

// Endpoints where a 401 means "bad credentials", not "access token expired".
const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

// On a 401, refresh the access token once and replay the request. If the
// refresh fails too, the session is over: hand control back to AuthProvider.
http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const request = error.config;
    const shouldRetry =
      error.response?.status === 401 &&
      request &&
      !request._retried &&
      !NO_RETRY.includes(request.url);
    if (!shouldRetry) throw error;

    request._retried = true;
    try {
      await refreshAccessToken();
    } catch {
      setAccessToken(null);
      onSessionExpired();
      throw error;
    }
    return http(request);
  },
);

/** The human-readable message from the API's error shape, with a fallback. */
export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  return error?.response?.data?.error?.message ?? fallback;
}
