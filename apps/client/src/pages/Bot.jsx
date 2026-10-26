import { Bot as BotIcon, Filter, Gauge, ShieldCheck } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

function Section({ icon: Icon, title, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900/60">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {children}
      </div>
    </section>
  );
}

function Code({ children }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-900 px-4 py-3 text-xs text-slate-100 dark:bg-slate-950">
      <code>{children}</code>
    </pre>
  );
}

/**
 * /bot: public page linked from the checker's User-Agent. Explains what the
 * requests are and how site owners can recognise, filter or reduce them.
 */
export default function Bot() {
  useDocumentTitle('About the PulseBoard checker');
  const botUrl = `${window.location.origin}/bot`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex items-center justify-between gap-4">
          <Logo />
          <ThemeToggle />
        </header>

        <h1 className="mt-10 text-3xl font-bold tracking-tight">About the PulseBoard checker</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          If you found <code className="text-sm">PulseBoard/1.0</code> in your logs, someone is
          monitoring the uptime of your site or API with PulseBoard. Each request is a small,
          scheduled check that the endpoint is up. Here is how to recognise those requests and keep
          them cheap.
        </p>

        <div className="mt-8 space-y-6">
          <Section icon={BotIcon} title="How to recognise a check">
            <p>Every check sends these two headers:</p>
            <Code>{`User-Agent: PulseBoard/1.0 (+${botUrl})\nX-PulseBoard-Check: 1`}</Code>
            <p>
              The <code>X-PulseBoard-Check</code> header is always present and can&apos;t be removed
              by the person who set up the monitor, so it is the most reliable signal.
            </p>
          </Section>

          <Section icon={Gauge} title="What a check does">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                New monitors send a <strong>HEAD</strong> request: headers only, no body. If your
                server answers HEAD with 405 or 501, PulseBoard switches that monitor to GET and
                remembers it.
              </li>
              <li>
                The response body is <strong>only downloaded when a keyword check</strong> is
                configured (at most 1&nbsp;MB). Otherwise the connection is closed as soon as the
                status line and headers arrive.
              </li>
              <li>Each check opens one fresh connection and follows at most 3 redirects.</li>
            </ul>
          </Section>

          <Section icon={Filter} title="Exclude checks from analytics and billing">
            <p>
              Filter on the header in your analytics, logging or metering layer. For example, in
              Express:
            </p>
            <Code>{`app.use((req, res, next) => {
  req.isUptimeCheck = req.get('x-pulseboard-check') === '1';
  next();
});`}</Code>
            <p>or skip them in nginx access logs:</p>
            <Code>{`map $http_x_pulseboard_check $loggable { "1" 0; default 1; }
access_log /var/log/nginx/access.log combined if=$loggable;`}</Code>
          </Section>

          <Section icon={ShieldCheck} title="Make checks cheaper">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                Point the monitor at a lightweight <code>/health</code> endpoint that answers
                quickly and doesn&apos;t touch your database or paid services (AI APIs, metered
                gateways).
              </li>
              <li>Use a longer check interval for endpoints that are billed per request.</li>
              <li>
                Push-based monitoring is coming to PulseBoard: heartbeat pings and an in-app agent
                report status without PulseBoard calling your endpoint at all.
              </li>
            </ul>
          </Section>
        </div>

        <footer className="mt-12 flex items-center justify-center gap-2 text-xs text-slate-500">
          Questions? Contact whoever set up the monitor, or see <Logo />
        </footer>
      </div>
    </div>
  );
}
