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
import { WALLETCONNECT_PROJECT_ID, XAMAN_API_KEY } from './config.js';
import { connectNetworkId, getNetwork, subscribeNetwork } from './network.js';

function buildAdapters(): WalletAdapter[] {
  const adapters: WalletAdapter[] = [new GemWalletAdapter(), new CrossmarkAdapter()];
  if (XAMAN_API_KEY) adapters.push(new XamanAdapter({ apiKey: XAMAN_API_KEY }));
  if (WALLETCONNECT_PROJECT_ID) {
    adapters.push(new WalletConnectAdapter({ projectId: WALLETCONNECT_PROJECT_ID }));
  }
  return adapters;
}

const adapters = buildAdapters();

// The WalletManager is bound to one network at construction, so switching the
// UI network rebuilds it. The current instance and the network it was built for
// are tracked here; `manager()` lazily (re)builds when they diverge.
let instance: WalletManager | undefined;
let instanceNetwork: string | undefined;

function manager(): WalletManager {
  const network = connectNetworkId(getNetwork());
  if (!instance || instanceNetwork !== network) {
    instance = new WalletManager({ adapters, network, autoConnect: false });
    instanceNetwork = network;
  }
  return instance;
}

// When the user toggles network, drop any wallet connected on the old network
// so the next connect happens on the newly selected one.
subscribeNetwork(() => {
  const previous = instance;
  if (previous && instanceNetwork !== connectNetworkId(getNetwork())) {
    void previous.disconnect().catch(() => {
      // best-effort; the manager is being discarded anyway
    });
    instance = undefined;
  }
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

/** Connect the chosen wallet on the selected network and return its address. */
export async function connectWallet(walletId: string): Promise<string> {
  const account = await manager().connect(walletId);
  return account.address;
}

/**
 * Sign the gateway challenge transaction (nonce embedded in a memo) with the
 * connected wallet and return the signed tx blob for `/auth/verify-tx`. The
 * transaction is signed only — never submitted.
 */
export async function signChallenge(address: string, nonce: string): Promise<string> {
  const tx = buildAuthChallengeTx(address, nonce) as unknown as Transaction;
  const signed: SignedTransaction = await manager().sign(tx);
  if (!signed.tx_blob) {
    throw new Error('wallet did not return a signed transaction blob');
  }
  return signed.tx_blob;
}

/** Disconnect the active wallet, ignoring errors. */
export async function disconnectWallet(): Promise<void> {
  try {
    await manager().disconnect();
  } catch {
    // best-effort
  }
}
