// The access token lives only in memory (never localStorage), so an XSS bug
// can't read a long-lived credential from storage. On page reload it is gone,
// and the app silently gets a new one using the httpOnly refresh cookie.
let accessToken = null;

export const getAccessToken = () => accessToken;

export function setAccessToken(token) {
  accessToken = token;
}
