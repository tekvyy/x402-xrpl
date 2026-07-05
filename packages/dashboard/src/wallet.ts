/**
 * Browser wallet integration via xrpl-connect. Builds a single WalletManager
 * with every adapter we have credentials for, and exposes helpers to connect a
 * wallet and sign the gateway's challenge transaction. GemWallet and Crossmark
 * work with zero config; Xaman / WalletConnect load only when their keys are set.
 */
import {
  WalletManager,
  GemWalletAdapter,
  CrossmarkAdapter,
  XamanAdapter,
  WalletConnectAdapter,
  type WalletAdapter,
  type SignedTransaction,
  type Transaction,
} from 'xrpl-connect';
import { buildAuthChallengeTx } from '@app/shared';
import { WALLETCONNECT_PROJECT_ID, XAMAN_API_KEY, XRPL_CONNECT_NETWORK } from './config.js';

function buildAdapters(): WalletAdapter[] {
  const adapters: WalletAdapter[] = [new GemWalletAdapter(), new CrossmarkAdapter()];
  if (XAMAN_API_KEY) adapters.push(new XamanAdapter({ apiKey: XAMAN_API_KEY }));
  if (WALLETCONNECT_PROJECT_ID) {
    adapters.push(new WalletConnectAdapter({ projectId: WALLETCONNECT_PROJECT_ID }));
  }
  return adapters;
}

const adapters = buildAdapters();

/** Shared wallet manager for the whole dashboard session. */
export const walletManager = new WalletManager({
  adapters,
  network: XRPL_CONNECT_NETWORK,
  autoConnect: false,
});

/** Selectable wallets, for rendering connect buttons. */
export interface WalletOption {
  id: string;
  name: string;
}

export const WALLET_OPTIONS: WalletOption[] = adapters.map((adapter) => ({
  id: adapter.id,
  name: adapter.name,
}));

/** Connect the chosen wallet and return its XRPL classic address. */
export async function connectWallet(walletId: string): Promise<string> {
  const account = await walletManager.connect(walletId);
  return account.address;
}

/**
 * Sign the gateway challenge transaction (nonce embedded in a memo) with the
 * connected wallet and return the signed tx blob for `/auth/verify-tx`. The
 * transaction is signed only — never submitted.
 */
export async function signChallenge(address: string, nonce: string): Promise<string> {
  const tx = buildAuthChallengeTx(address, nonce) as unknown as Transaction;
  const signed: SignedTransaction = await walletManager.sign(tx);
  if (!signed.tx_blob) {
    throw new Error('wallet did not return a signed transaction blob');
  }
  return signed.tx_blob;
}

/** Disconnect the active wallet, ignoring errors. */
export async function disconnectWallet(): Promise<void> {
  try {
    await walletManager.disconnect();
  } catch {
    // best-effort
  }
}
