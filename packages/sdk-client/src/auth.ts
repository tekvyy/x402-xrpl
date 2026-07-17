/**
 * Client-side sign-in-with-XRPL. Signs a gateway challenge with a wallet seed
 * (locally — the seed never leaves the caller) and exchanges it for a dashboard
 * session token. Programmatic/headless use only (demo orchestrator, tests);
 * interactive users sign in from the dashboard with a browser wallet.
 */
import { Wallet } from 'xrpl';
import { sign } from 'ripple-keypairs';
import type {
  AuthChallengeResponse,
  AuthVerifyResponse,
} from '@app/shared';

/** Minimal `fetch` surface, so callers can inject a custom implementation. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Sign a sign-in message with a wallet, returning signature + public key. */
export function signSignInMessage(
  wallet: Wallet,
  message: string,
): { signature: string; publicKey: string } {
  const messageHex = Buffer.from(message, 'utf8').toString('hex');
  return { signature: sign(messageHex, wallet.privateKey), publicKey: wallet.publicKey };
}

export interface SignInParams {
  gatewayUrl: string;
  /** XRPL family seed of the wallet to sign in with. */
  seed: string;
  /** Custom fetch (defaults to the global). */
  fetchImpl?: FetchLike;
}

/**
 * Run the full challenge → sign → verify handshake against a gateway and return
 * the session token. Throws with a readable message on any non-2xx step.
 */
export async function signInWithGateway(params: SignInParams): Promise<AuthVerifyResponse> {
  const doFetch = (params.fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  const base = params.gatewayUrl.replace(/\/+$/, '');
  const wallet = Wallet.fromSeed(params.seed);

  const challengeRes = await doFetch(`${base}/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.classicAddress }),
  });
  if (!challengeRes.ok) throw new Error(`challenge failed (${challengeRes.status})`);
  const challenge = (await challengeRes.json()) as AuthChallengeResponse;

  const { signature, publicKey } = signSignInMessage(wallet, challenge.message);
  const verifyRes = await doFetch(`${base}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address: wallet.classicAddress,
      nonce: challenge.nonce,
      signature,
      publicKey,
    }),
  });
  if (!verifyRes.ok) throw new Error(`verification failed (${verifyRes.status})`);
  return (await verifyRes.json()) as AuthVerifyResponse;
}
