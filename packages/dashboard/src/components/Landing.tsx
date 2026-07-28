/**
 * Public landing page. Two jobs: explain the gateway in one screen, and expose
 * the live service registry — every registered API an agent can pay for right
 * now — with the exact commands to start consuming or selling.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { XrplNetwork, safeHref } from '@app/shared';
import { fetchCatalog, type Catalog, type CatalogService } from '../api.js';
import { GATEWAY_URL, REPO_URL } from '../config.js';
import { trimDecimal } from '../format.js';
import { useNetwork } from '../network.js';
import { NetworkToggle } from './NetworkToggle.js';
import { CardSkeleton } from './States.js';

interface LandingProps {
  onSignIn: () => void;
}

/** The hero terminal trace: one full x402 exchange, typed line by line. */
const TRACE: readonly string[] = [
  '$ curl https://api.example.dev/data',
  '< HTTP/1.1 402 Payment Required',
  '< accepts: 0.01 XRP · pay-per-call | prepaid-credits',
  '$ x402fetch: signing channel claim for 0.01 XRP…',
  '< HTTP/1.1 200 OK',
  '< x-payment-response: SETTLED',
  '{ "message": "premium data unlocked" }',
];

function useTypedTrace(lines: readonly string[]): number {
  const [visible, setVisible] = useState(1);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(lines.length);
      return;
    }
    const timer = window.setInterval(() => {
      setVisible((count) => {
        if (count >= lines.length) {
          window.clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, 550);
    return () => window.clearInterval(timer);
  }, [lines]);
  return visible;
}

/** GitHub's mark, inlined so the link needs no icon dependency. */
function GithubMark(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="currentColor"
    >
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.34c-2.23.49-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.14.46.55.38A8 8 0 0 0 8 0Z" />
    </svg>
  );
}

function setupLabel(mode: CatalogService['paymentMode']): string[] {
  if (mode === 'BOTH') return ['PAY_PER_CALL', 'PREPAID_CREDITS'];
  return [mode];
}

/**
 * A seller's origin, linked only when it is a real http(s) URL. Sellers supply
 * this string, so it is never trusted straight into an `href`: a `javascript:`
 * origin would otherwise run in every catalog visitor's session. Registration
 * rejects those schemes now, but rows written before it did are still served,
 * so the link defends itself and shows the raw text when it cannot.
 */
function ServiceOrigin({ originUrl }: { originUrl: string }): JSX.Element {
  const href = safeHref(originUrl);
  const label = originUrl.replace(/^https?:\/\//, '');
  if (!href) return <span className="svc-origin">{label}</span>;
  return (
    <a className="svc-origin" href={href} rel="noreferrer" target="_blank">
      {label}
    </a>
  );
}

/** One registry row: identity, price, modes, and the ids an agent needs. */
function ServiceRow({ service }: { service: CatalogService }): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copyId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(service.sellerId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (http, permissions); the id stays visible.
    }
  }

  return (
    <li className="svc-row">
      <div className="svc-id">
        <span className="svc-name">{service.name}</span>
        <ServiceOrigin originUrl={service.originUrl} />
      </div>
      <div className="svc-price">
        <span className="svc-price-amount">{trimDecimal(service.priceAmount)}</span>
        <span className="svc-price-asset"> {service.priceAsset}</span>
        <span className="svc-price-per"> / call</span>
      </div>
      <div className="svc-modes">
        {setupLabel(service.paymentMode).map((mode) => (
          <span key={mode} className={`chip chip-${mode.toLowerCase()}`}>
            {mode === 'PAY_PER_CALL' ? 'per call' : 'credits'}
          </span>
        ))}
      </div>
      <button className="btn svc-copy" type="button" onClick={copyId} title={service.sellerId}>
        {copied ? 'copied' : `id:${service.sellerId.slice(0, 8)}…`}
      </button>
    </li>
  );
}

/**
 * Copies the gateway-served agent skill (markdown) to the clipboard, so a
 * builder can paste it straight into their agent's context or skill file.
 */
function CopySkillButton(): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copySkill(): Promise<void> {
    try {
      const response = await fetch(`${GATEWAY_URL}/skill.md`);
      if (!response.ok) throw new Error(`gateway responded ${response.status}`);
      await navigator.clipboard.writeText(await response.text());
      setState('copied');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2000);
  }

  return (
    <button className="btn btn-primary" type="button" onClick={copySkill}>
      {state === 'copied'
        ? 'Copied. Paste into your agent'
        : state === 'failed'
          ? 'Copy failed. Use the URL'
          : 'Copy agent skill (.md)'}
    </button>
  );
}

export function Landing({ onSignIn }: LandingProps): JSX.Element {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const registryRef = useRef<HTMLElement | null>(null);
  const typedLines = useTypedTrace(TRACE);
  const { network } = useNetwork();

  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch(() => {
        if (!cancelled) setError('The gateway is unreachable. Start it, then reload.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The registry is scoped to the network selected in the header toggle: each
  // network is its own experience, with its own set of advertised services.
  const services = (catalog?.services ?? []).filter((service) =>
    service.networks.includes(network),
  );
  const networkLabel = network === XrplNetwork.MAINNET ? 'Mainnet' : 'Testnet';
  const agentSnippet = useMemo(
    () =>
      [
        `$ curl ${GATEWAY_URL}/skill.md`,
        '# → the full how-to-pay skill for your agent (also at /llms.txt)',
        `$ curl ${GATEWAY_URL}/catalog`,
        '# → this registry as JSON: pick a sellerId, then',
        '',
        "const res = await x402fetch(serviceUrl + '/data', {",
        '  x402: { wallet, client, sourceTag,',
        "          maxAmount: { XRP: '0.05' } },",
        '});',
      ].join('\n'),
    [],
  );

  return (
    <div className="app landing">
      <header className="app-header">
        <button
          className="brand"
          type="button"
          aria-label="XRPL x402 Gateway home"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <span className="brand-mark">x402</span>
          <div className="brand-text">
            <h1>
              XRPL x402 Gateway <span className="beta-badge">Beta</span>
            </h1>
            <p>Monetize APIs · run paying agents</p>
          </div>
        </button>
        <div className="session">
          <NetworkToggle />
          <a
            className="btn repo-link"
            href={REPO_URL}
            rel="noreferrer"
            target="_blank"
            title="Source on GitHub (MIT)"
          >
            <GithubMark />
            GitHub
          </a>
          <button className="btn" type="button" onClick={onSignIn}>
            Sign in with wallet
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1 className="hero-title">
            Your API answers <span className="hero-402">402</span>.
            <br />
            Machines pay it.
          </h1>
          <p className="hero-sub">
            A drop-in facilitator for the x402 protocol on the XRP Ledger. Agents that can hold a
            wallet, but not a credit card, pay per call in XRP or RLUSD: no signup, no subscription,
            no payment processor. One middleware line on your server; settlement in seconds on
            chain.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" type="button" onClick={onSignIn}>
              Monetize an API
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => registryRef.current?.scrollIntoView({ behavior: 'smooth' })}
            >
              Browse services ↓
            </button>
          </div>
        </div>

        <div className="term" aria-label="An x402 payment exchange">
          <div className="term-bar">
            <span className="term-title">agent@xrpl:~</span>
            <span className="term-net">{network}</span>
          </div>
          <pre className="term-body">
            {TRACE.slice(0, typedLines).map((line, index) => (
              <span
                key={line}
                className={
                  line.startsWith('$') ? 'term-cmd' : line.startsWith('<') ? 'term-hdr' : 'term-out'
                }
              >
                {line}
                {'\n'}
                {index === typedLines - 1 && typedLines < TRACE.length && (
                  <span className="term-cursor" aria-hidden="true" />
                )}
              </span>
            ))}
          </pre>
        </div>
      </section>

      <section className="lanes">
        <div className="card panel lane">
          <h2>Sell: meter your API</h2>
          <ol className="lane-steps">
            <li>Sign in with your XRPL wallet. A signed challenge, no fees, no seed.</li>
            <li>Register the API: name, price per call, payout address, payment setup.</li>
            <li>
              Install the middleware:
              <code className="lane-code">npm i @xrpl-x402/server</code>
              MIT licensed and{' '}
              <a className="foot-link" href={REPO_URL} rel="noreferrer" target="_blank">
                open source on GitHub
              </a>
              .
            </li>
            <li>
              Add it to your own routes. It is pure delegation: no XRPL code, no pricing, just two
              HTTP calls to this facilitator.
              <code className="lane-code">
                app.get(&apos;/premium&apos;, {'{ preHandler: x402Fastify(cfg) }'}, handler)
              </code>
            </li>
            <li>Watch revenue, callers, and settlements stream live on the dashboard.</li>
          </ol>
        </div>
        <div className="card panel lane">
          <h2>Buy: point your agent at it</h2>
          <ol className="lane-steps">
            <li>Fund an XRPL wallet. That is the whole onboarding.</li>
            <li>Pick a service from the registry below (or fetch it as JSON).</li>
            <li>
              <code className="lane-code">x402fetch(url, {'{ x402 }'})</code> hits the 402, pays it,
              retries, and returns the real response.
            </li>
            <li>
              Calling one service a lot? Open a payment channel once and spend credits off-ledger:
              no per-call on-chain wait.
            </li>
          </ol>
        </div>
      </section>

      <section className="registry" id="registry" ref={registryRef}>
        <div className="panel-head registry-head">
          <h2 className="panel-title">Service registry</h2>
          <span className="feed-status feed-status-live">
            <span className="dot" />
            {catalog ? `${services.length} live on ${networkLabel}` : 'connecting'}
          </span>
        </div>

        {error && <div className="error-banner">{error}</div>}
        {!error && !catalog && (
          <div className="card panel">
            <CardSkeleton rows={4} />
          </div>
        )}
        {catalog && services.length === 0 && (
          <div className="empty-state">
            No services registered on {networkLabel} yet. Sign in and register the first one: it
            appears here the moment it exists.
          </div>
        )}
        {services.length > 0 && (
          <ul className="svc-list card">
            {services.map((service) => (
              <ServiceRow key={service.sellerId} service={service} />
            ))}
          </ul>
        )}

        <div className="agent-strip card panel">
          <h2>For agents: consume this registry programmatically</h2>
          <pre className="agent-snippet">{agentSnippet}</pre>
          <div className="hero-actions">
            <CopySkillButton />
            <a className="btn" href={`${GATEWAY_URL}/skill.md`} rel="noreferrer" target="_blank">
              View skill.md
            </a>
          </div>
          <p className="agent-note">
            The skill is a self-contained markdown doc teaching any agent XRPL wallet management
            (safe key handling, signing, submission) plus the full pay-per-call and prepaid-credits
            flow. Paste it into your agent&apos;s context or point it at the URL. Full client
            helpers (channels, claims, trustlines) ship in <code>@xrpl-x402/client</code>; the 402
            challenge itself is self-describing, so any HTTP client that can sign an XRPL
            transaction can pay. The gateway, both SDKs, and this dashboard are{' '}
            <a className="foot-link" href={REPO_URL} rel="noreferrer" target="_blank">
              open source on GitHub
            </a>
            , so you can audit the settlement path or self-host the whole thing.
          </p>
        </div>
      </section>

      <footer className="landing-foot">
        <span>
          facilitator <code>{GATEWAY_URL}</code>
        </span>
        <span>
          <a className="foot-link" href={REPO_URL} rel="noreferrer" target="_blank">
            Open source on GitHub (MIT)
          </a>
          {' · '}
          run your own facilitator
        </span>
        <span>x402 on the XRP Ledger · every settlement source-tagged on chain · Beta</span>
      </footer>
    </div>
  );
}
