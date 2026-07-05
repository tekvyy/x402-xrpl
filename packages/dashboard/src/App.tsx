/**
 * Dashboard shell. Gates on a sign-in-with-XRPL session, then presents two
 * role-aware tabs: "My APIs" (sell — register + monitor origins) and "My Bots"
 * (buy — configure + monitor self-custody paying agents).
 */
import { useCallback, useState } from 'react';
import { clearSession, loadSession, saveSession, type Session } from './auth.js';
import { shortenAddress } from './format.js';
import { Login } from './components/Login.js';
import { SellerTab } from './components/SellerTab.js';
import { BotTab } from './components/BotTab.js';

enum Tab {
  APIS = 'APIS',
  BOTS = 'BOTS',
}

export function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [tab, setTab] = useState<Tab>(Tab.APIS);

  const authenticate = useCallback((next: Session) => {
    saveSession(next.token);
    setSession(next);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  if (!session) return <Login onAuthenticated={authenticate} />;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">x402</span>
          <div className="brand-text">
            <h1>XRPL x402 Gateway</h1>
            <p>Monetize APIs · run paying agents</p>
          </div>
        </div>
        <div className="session">
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
