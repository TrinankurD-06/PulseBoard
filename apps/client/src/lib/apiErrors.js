// Plain-language wording for the API's suspension and administrator errors. The server's
// message carries the reason; this makes sure the sentence also says what was stopped.

const mentions = (message, pattern) => typeof message === 'string' && pattern.test(message);

/**
 * The text to show for an API error `code` and `message`, or `message` itself for any code
 * this does not know. Never invents a reason: it only adds the missing subject.
 */
export function describeApiError(code, message) {
  switch (code) {
    case 'WORKSPACE_SUSPENDED':
      if (mentions(message, /suspend/i)) return message;
      return message ? `This workspace is suspended: ${message}` : 'This workspace is suspended.';
    case 'ACCOUNT_SUSPENDED':
      if (mentions(message, /suspend/i)) return message;
      return message ? `This account is suspended: ${message}` : 'This account is suspended.';
    case 'STOPPED_BY_ADMIN':
      return mentions(message, /administrator/i)
        ? message
        : 'An administrator stopped this monitor. Only an administrator can start it again.';
    case 'ADMIN_PROTECTED':
      return message || 'This account is protected and cannot be changed here.';
    default:
      return message;
  }
}
