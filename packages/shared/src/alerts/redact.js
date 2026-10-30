// Messages stored for the admin console (alert failures, server errors) must not carry secrets that
// happened to be in an error text: webhook URLs are credentials, and so are connection strings.
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/** Replaces every URL with "[url]" and cuts the text to `max` characters. */
export function redactMessage(text, max = 300) {
  return String(text ?? '')
    .replace(URL_PATTERN, '[url]')
    .slice(0, max);
}
