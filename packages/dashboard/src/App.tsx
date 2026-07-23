/**
 * Dashboard shell. Gates on a sign-in-with-XRPL session, then presents two
 * role-aware tabs: "My APIs" (sell — register + monitor origins) and "My Bots"
 * (buy — configure + monitor self-custody paying agents).
 */
import { useCallback, useState } from 'react';
import { clearSession, consumeUrlToken, loadSession, saveSession, type Session } from './auth.js';
import { shortenAddress } from './format.js';
import { Landing } from './components/Landing.js';
import { Login } from './components/Login.js';
import { SellerTab } from './components/SellerTab.js';
import { BotTab } from './components/BotTab.js';
import { NetworkToggle } from './components/NetworkToggle.js';

enum Tab {
  APIS = 'APIS',
  BOTS = 'BOTS',
}

export function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(() => consumeUrlToken() ?? loadSession());
  const [tab, setTab] = useState<Tab>(Tab.APIS);
  const [showLogin, setShowLogin] = useState(false);

  const authenticate = useCallback((next: Session) => {
    saveSession(next.token);
    setSession(next);
    setShowLogin(false);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  if (!session) {
    return showLogin ? (
      <Login onAuthenticated={authenticate} onBack={() => setShowLogin(false)} />
    ) : (
      <Landing onSignIn={() => setShowLogin(true)} />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <button
          className="brand"
          type="button"
          aria-label="XRPL x402 Gateway home"
          onClick={() => {
            setTab(Tab.APIS);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        >
          <span className="brand-mark">x402</span>
          <div className="brand-text">
            <h1>XRPL x402 Gateway</h1>
            <p>Monetize APIs · run paying agents</p>
          </div>
        </button>
        <div className="session">
          <NetworkToggle />
          <span className="session-addr" title={session.address}>
            <span className="dot" /> {shortenAddress(session.address)}
          </span>
          <button className="btn" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${tab === Tab.APIS ? 'tab-active' : ''}`}
          type="button"
          onClick={() => setTab(Tab.APIS)}
        >
          My APIs
        </button>
        <button
          className={`tab ${tab === Tab.BOTS ? 'tab-active' : ''}`}
          type="button"
          onClick={() => setTab(Tab.BOTS)}
        >
          My Bots
        </button>
      </nav>

      <main className="app-main">
        {tab === Tab.APIS ? (
          <SellerTab token={session.token} onUnauthorized={logout} />
        ) : (
          <BotTab token={session.token} onUnauthorized={logout} />
        )}
      </main>
    </div>
  );
}
