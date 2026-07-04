/**
 * Wallet loading. The agent holds its own XRPL key material; the SDK never
 * transmits the seed — it only signs locally before submitting transactions.
 */
import { Client, Wallet } from 'xrpl';
import { XrplNetwork, XRPL_ENDPOINTS } from '@app/shared';

/** Derive a signing wallet from a family seed (e.g. `sEd...`). */
export function loadWallet(seed: string): Wallet {
  return Wallet.fromSeed(seed);
}

/**
 * Build a (not-yet-connected) XRPL client for a network. Callers connect it
 * once and pass it into {@link x402fetch} so payments reuse a single socket.
 */
export function createClient(network: XrplNetwork): Client {
  return new Client(XRPL_ENDPOINTS[network]);
}

/** Connect the client if it is not already connected. */
export async function ensureConnected(client: Client): Promise<void> {
  if (!client.isConnected()) await client.connect();
}
