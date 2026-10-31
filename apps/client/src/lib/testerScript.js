// Third-party tester-feedback script: production builds only, switched on with
// VITE_ENABLE_TESTER_SCRIPT=true, and never on the public status page or the admin console.

const SCRIPT_SRC = 'https://cdn.firstusers.aevrinlabs.com/v1/fu.js';
const SCRIPT_ATTRIBUTES = {
  'data-app': 'app_01M6856067WQX12XDFSX4Y106P',
  'data-api': 'https://firstusers-api.n31vfqjhge7aa.ap-south-1.cs.amazonlightsail.com',
};

/** Pages the script must never run on: public status pages and the admin console. */
export function isExcludedPath(pathname) {
  return /^\/(status|app\/admin)(\/|$)/.test(pathname);
}

export function isTesterScriptLoaded(doc = document) {
  return Boolean(doc.querySelector(`script[src="${SCRIPT_SRC}"]`));
}

/** Adds the script (async, attributes as given) unless it is already there. Returns true if added. */
export function loadTesterScript(doc = document) {
  if (isTesterScriptLoaded(doc)) return false;
  const script = doc.createElement('script');
  script.src = SCRIPT_SRC;
  for (const [name, value] of Object.entries(SCRIPT_ATTRIBUTES)) script.setAttribute(name, value);
  script.async = true;
  doc.head.appendChild(script);
  return true;
}
