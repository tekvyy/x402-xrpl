/**
 * The selected XRPL network, chosen in the UI at runtime — there is no network
 * env var. A tiny external store (rather than React context) so non-React code
 * (the wallet manager in `wallet.ts`) can read the current network and react to
 * changes too. Persisted to localStorage so a reload keeps the choice.
 */
import { useSyncExternalStore } from 'react';
import { XrplNetwork } from '@app/shared';
import { NETWORK_STORAGE_KEY } from './config.js';

function isNetwork(value: unknown): value is XrplNetwork {
  return value === XrplNetwork.MAINNET || value === XrplNetwork.TESTNET;
}

function load(): XrplNetwork {
  try {
    const stored = window.localStorage.getItem(NETWORK_STORAGE_KEY);
    if (isNetwork(stored)) return stored;
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return XrplNetwork.MAINNET;
}

let current: XrplNetwork = load();
const listeners = new Set<() => void>();

/** The currently selected network. */
export function getNetwork(): XrplNetwork {
  return current;
}

/** Select a network, persist it, and notify subscribers. No-op if unchanged. */
export function setNetwork(next: XrplNetwork): void {
  if (next === current) return;
  current = next;
  try {
    window.localStorage.setItem(NETWORK_STORAGE_KEY, next);
  } catch {
    // Persistence is a convenience; ignore storage failures.
  }
  for (const listener of listeners) listener();
}

/** Subscribe to network changes; returns an unsubscribe function. */
export function subscribeNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The network id xrpl-connect expects for a given XRPL network. */
export function connectNetworkId(network: XrplNetwork): 'mainnet' | 'testnet' {
  return network === XrplNetwork.MAINNET ? 'mainnet' : 'testnet';
}

/** React binding for the selected network. */
export function useNetwork(): { network: XrplNetwork; setNetwork: (n: XrplNetwork) => void } {
  const network = useSyncExternalStore(subscribeNetwork, getNetwork, getNetwork);
  return { network, setNetwork };
}
