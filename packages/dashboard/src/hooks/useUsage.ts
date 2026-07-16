/**
 * Loads the three aggregate usage views for a seller in one shot, exposing a
 * unified loading/error state plus a `reload` for manual and live-driven
 * refreshes. Aborts in-flight requests when the seller changes or the component
 * unmounts.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchByWallet,
  fetchSummary,
  fetchTopEndpoints,
  type EndpointUsage,
  type UsageSummary,
  type WalletUsage,
} from '../api.js';

export interface UsageData {
  summary: UsageSummary;
  endpoints: EndpointUsage[];
  wallets: WalletUsage[];
}

export interface UsageState {
  data: UsageData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useUsage(token: string, sellerId: string | null): UsageState {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the effect to refetch on demand.
  const [nonce, setNonce] = useState<number>(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!sellerId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    // Only the first load shows the skeleton; live-driven reloads refresh in place.
    setLoading((prev) => prev || data === null);
    setError(null);

    Promise.all([
      fetchSummary(token, sellerId, controller.signal),
      fetchTopEndpoints(token, sellerId, controller.signal),
      fetchByWallet(token, sellerId, controller.signal),
    ])
      .then(([summary, endpoints, wallets]) => {
        setData({ summary, endpoints, wallets });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load usage');
        setLoading(false);
      });

    return () => controller.abort();
    // `data` is intentionally excluded from deps: it is only read to decide
    // whether to show the skeleton, and must not retrigger the fetch.
  }, [token, sellerId, nonce]);

  return { data, loading, error, reload };
}
