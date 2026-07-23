/**
 * Sign-in-with-XRPL entry screen. Connect a browser wallet (GemWallet,
 * Crossmark, Xaman, WalletConnect) via xrpl-connect and sign the gateway's
 * challenge transaction — the seed never leaves the wallet.
 */
import { useState } from 'react';
import { requestAuthChallenge, verifyAuthTx } from '../api.js';
import { sessionFromToken, type Session } from '../auth.js';
import { WALLET_OPTIONS, connectWallet, disconnectWallet, signChallenge } from '../wallet.js';
import { NetworkToggle } from './NetworkToggle.js';
import { Spinner } from './States.js';

interface LoginProps {
  onAuthenticated: (session: Session) => void;
  /** Return to the public landing page. */
  onBack?: () => void;
}

export function Login({ onAuthenticated, onBack }: LoginProps): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connectWith(walletId: string): Promise<void> {
    setBusy(walletId);
    setError(null);
    try {
      const address = await connectWallet(walletId);
      const { nonce } = await requestAuthChallenge(address);
      const txBlob = await signChallenge(address, nonce);
      const verified = await verifyAuthTx(address, nonce, txBlob);
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

  return (
    <div className="login">
      <div className="login-card">
        {onBack ? (
          <button
            className="brand login-brand"
            type="button"
            aria-label="Back to XRPL x402 Gateway home"
            onClick={onBack}
          >
            <span className="brand-mark">x402</span>
            <div className="brand-text">
              <h1>XRPL x402 Gateway</h1>
              <p>Sign in with your XRPL wallet</p>
            </div>
          </button>
        ) : (
          <div className="brand login-brand">
            <span className="brand-mark">x402</span>
            <div className="brand-text">
              <h1>XRPL x402 Gateway</h1>
              <p>Sign in with your XRPL wallet</p>
            </div>
          </div>
        )}

        <label className="login-network">
          <span>Network</span>
          <NetworkToggle />
        </label>

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
          You&apos;ll sign a one-time challenge — no transaction is submitted and no fees are
          charged.
        </p>

        {error && <p className="login-error">{error}</p>}

        {onBack && (
          <button className="login-back" type="button" onClick={onBack}>
            ← back to the registry
          </button>
        )}
      </div>
    </div>
  );
}
