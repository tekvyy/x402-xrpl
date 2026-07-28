/**
 * Dashboard session state. The session token is minted by the gateway after a
 * sign-in-with-XRPL handshake (signed by the user's browser wallet) and stored
 * locally. We only *read* the address out of the token for display — the
 * gateway is the sole authority on validity.
 */
import { TOKEN_STORAGE_KEY } from './config.js';

export interface Session {
  token: string;
  address: string;
  /** Unix epoch (ms) at which the token expires. */
  expiresAt: number;
}

/** Decode the `<payload>.<sig>` token's payload without verifying it. */
function decodePayload(token: string): { sub?: unknown; exp?: unknown } | null {
  const [payload] = token.split('.');
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as { sub?: unknown; exp?: unknown };
  } catch {
    return null;
  }
}

/** Parse a raw token into a Session, or null when malformed/expired. */
export function sessionFromToken(token: string): Session | null {
  const trimmed = token.trim();
  const payload = decodePayload(trimmed);
  if (!payload || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Date.now()) return null;
  return { token: trimmed, address: payload.sub, expiresAt: payload.exp };
}

/** Load a persisted session, dropping it if missing or expired. */
export function loadSession(): Session | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const session = sessionFromToken(raw);
  if (!session) clearSession();
  return session;
}

export function saveSession(token: string): Session | null {
  const session = sessionFromToken(token);
  if (!session) return null;
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, session.token);
  } catch {
    // Non-fatal: persistence is a convenience.
  }
  return session;
}

/**
 * Consume a session token handed over in the URL fragment (`#token=…`), which
 * is how a headless caller signs in a wallet no browser extension holds (see
 * `signInWithGateway` in `@xrpl-x402/client`). The fragment never reaches the
 * server; it is stripped from the address bar immediately after being read.
 */
export function consumeUrlToken(): Session | null {
  const token = /[#&]token=([^&]+)/.exec(window.location.hash)?.[1];
  if (!token) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return saveSession(decodeURIComponent(token));
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
