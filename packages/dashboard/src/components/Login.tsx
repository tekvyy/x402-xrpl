/**
 * Sign-in-with-XRPL entry screen. Primary path: connect a browser wallet
 * (GemWallet, Crossmark, Xaman, WalletConnect) via xrpl-connect and sign the
 * gateway's challenge transaction — the seed never leaves the wallet. Fallback:
 * paste a session token minted by the `pnpm login` CLI (for headless/demo use).
 */
import { useState } from 'react';
import { fetchMySellers, requestAuthChallenge, verifyAuthTx, UnauthorizedError } from '../api.js';
import { sessionFromToken, type Session } from '../auth.js';
import { WALLET_OPTIONS, connectWallet, disconnectWallet, signChallenge } from '../wallet.js';
import { Spinner } from './States.js';

interface LoginProps {
  onAuthenticated: (session: Session) => void;
}

export function Login({ onAuthenticated }: LoginProps): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState<boolean>(false);
  const [token, setToken] = useState<string>('');

  async function connectWith(walletId: string): Promise<void> {
    setBusy(walletId);
    setError(null);
    try {
      const address = await connectWallet(walletId);
      const { nonce } = await requestAuthChallenge(address);
      const txBlob = await signChallenge(address, nonce);
      const verified = await verifyAuthTx(address, txBlob);
      const session = sessionFromToken(verified.token);
      if (!session) throw new Error('gateway returned an invalid token');
      onAuthenticated(session);
    } catch (err) {
      await disconnectWallet();
      setError(err instanceof Error ? err.message : 'Wallet sign-in failed');
    } finally {
      setBusy(null);
    }
  }

  async function submitToken(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const session = sessionFromToken(token);
    if (!session) {
      setError('That token is invalid or expired. Generate a fresh one.');
      return;
    }
    setBusy('token');
    setError(null);
    try {
      await fetchMySellers(session.token);
      onAuthenticated(session);
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? 'The gateway rejected this token. Generate a fresh one.'
          : 'Could not reach the gateway. Is it running?',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand login-brand">
          <span className="brand-mark">x402</span>
          <div className="brand-text">
            <h1>XRPL x402 Gateway</h1>
            <p>Sign in with your XRPL wallet</p>
          </div>
        </div>

        <div className="wallet-list">
          {WALLET_OPTIONS.map((wallet) => (
            <button
              key={wallet.id}
              className="btn btn-wallet"
              type="button"
              disabled={busy !== null}
              onClick={() => connectWith(wallet.id)}
            >
              {busy === wallet.id ? <Spinner /> : `Connect ${wallet.name}`}
            </button>
          ))}
        </div>
        <p className="login-hint">
          You&apos;ll sign a one-time challenge — no transaction is submitted and no fees are charged.
        </p>

        {error && <p className="login-error">{error}</p>}

        <button className="link-button" type="button" onClick={() => setShowToken((v) => !v)}>
          {showToken ? 'Hide' : 'Advanced: paste a session token'}
        </button>

        {showToken && (
          <form className="login-form" onSubmit={submitToken}>
            <p className="login-hint">
              No browser wallet? Run <code>pnpm login &lt;seed&gt;</code> and paste the token:
            </p>
            <textarea
              className="login-token"
              placeholder="Paste session token"
              value={token}
              spellCheck={false}
              autoComplete="off"
              rows={3}
              onChange={(e) => setToken(e.target.value)}
              aria-label="Session token"
            />
            <button
              className="btn btn-primary"
              type="submit"
              disabled={busy !== null || token.trim() === ''}
            >
              {busy === 'token' ? <Spinner /> : 'Use token'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
