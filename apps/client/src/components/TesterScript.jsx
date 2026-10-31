import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isExcludedPath, isTesterScriptLoaded, loadTesterScript } from '../lib/testerScript.js';

// A literal comparison, so the bundler removes all of this (and the script's address) from builds
// that don't switch the script on.
const ENABLED = import.meta.env.PROD && import.meta.env.VITE_ENABLE_TESTER_SCRIPT === 'true';

/**
 * Loads the tester-feedback script on pages where it is allowed. A script can't be unloaded, so if
 * the app navigates from an allowed page (say, sign-in) into an excluded one (the admin console)
 * the page reloads there, which leaves the script out.
 */
export default function TesterScript() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!ENABLED) return;
    if (!isExcludedPath(pathname)) loadTesterScript();
    else if (isTesterScriptLoaded()) window.location.reload();
  }, [pathname]);
  return null;
}
