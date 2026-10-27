import { Link } from 'react-router-dom';
import PublicHeader from '../components/public/PublicHeader.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

function Section({ n, title, children }) {
  return (
    <section className="grid gap-4 border-t border-line py-10 md:grid-cols-[220px_1fr] md:gap-10">
      <div>
        <span className="text-[11px] text-faint">{n}</span>
        <h2 className="mt-2 text-xl leading-tight font-light tracking-[-0.02em] text-fg">
          {title}
        </h2>
      </div>
      <div className="min-w-0 space-y-4 text-sm leading-relaxed text-muted [&_strong]:font-medium [&_strong]:text-fg">
        {children}
      </div>
    </section>
  );
}

function Code({ children }) {
  return (
    <pre className="overflow-x-auto rounded-card border border-line bg-surface px-4 py-3 font-mono text-xs text-fg">
      <code>{children}</code>
    </pre>
  );
}

const inline = 'font-mono text-[13px] text-fg';

/**
 * /bot: public page linked from the checker's User-Agent. Explains what the
 * requests are and how site owners can recognise, filter or reduce them.
 */
export default function Bot() {
  useDocumentTitle('About the PulseBoard checker');
  const botUrl = `${window.location.origin}/bot`;

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-12 pb-16 sm:px-8">
        <div className="max-w-4xl">
          <h1
            className="animate-rise font-light tracking-[-0.03em] text-fg"
            style={{ fontSize: 'clamp(32px, 4.5vw, 56px)', lineHeight: 1.05 }}
          >
            About the PulseBoard checker
          </h1>
          <p className="mt-5 max-w-[60ch] text-[15px] leading-relaxed text-muted">
            If you found <code className={inline}>PulseBoard/1.0</code> in your logs, someone is
            monitoring the uptime of your site or API with PulseBoard. Each request is a small,
            scheduled check that the endpoint is up. Here is how to recognise those requests and
            keep them cheap.
          </p>

          <div className="mt-14">
            <Section n="01" title="How to recognise a check">
              <p>Every check sends these two headers:</p>
              <Code>{`User-Agent: PulseBoard/1.0 (+${botUrl})\nX-PulseBoard-Check: 1`}</Code>
              <p>
                The <code className={inline}>X-PulseBoard-Check</code> header is always present and
                can&apos;t be removed by the person who set up the monitor, so it is the most
                reliable signal.
              </p>
            </Section>

            <Section n="02" title="What a check does">
              <ul className="list-disc space-y-2 pl-5 marker:text-faint">
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

            <Section n="03" title="Exclude checks from analytics and billing">
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

            <Section n="04" title="Make checks cheaper">
              <ul className="list-disc space-y-2 pl-5 marker:text-faint">
                <li>
                  Point the monitor at a lightweight <code className={inline}>/health</code>{' '}
                  endpoint that answers quickly and doesn&apos;t touch your database or paid
                  services (AI APIs, metered gateways).
                </li>
                <li>Use a longer check interval for endpoints that are billed per request.</li>
                <li>
                  Push-based monitoring is coming to PulseBoard: heartbeat pings and an in-app agent
                  report status without PulseBoard calling your endpoint at all.
                </li>
              </ul>
            </Section>
          </div>
        </div>
      </main>
      <footer className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-3 px-5 py-8 text-[11px] text-faint sm:px-8">
        <span>Questions? Contact whoever set up the monitor.</span>
        <Link to="/" className="transition-colors duration-200 hover:text-fg">
          PulseBoard
        </Link>
      </footer>
    </div>
  );
}
