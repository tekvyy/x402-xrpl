/**
 * "My APIs" tab: register origin APIs, pick one, and watch its live revenue,
 * usage, and settlement feed (the original seller dashboard, now scoped to the
 * signed-in owner's sellers).
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchMySellers, UnauthorizedError, type SellerInfo } from '../api.js';
import { useUsage } from '../hooks/useUsage.js';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { RegisterApiForm } from './RegisterApiForm.js';
import { SummaryCards } from './SummaryCards.js';
import { TopEndpoints } from './TopEndpoints.js';
import { WalletTable } from './WalletTable.js';
import { LiveFeed } from './LiveFeed.js';
import { CardSkeleton, EmptyState, ErrorBanner, Spinner } from './States.js';

interface SellerTabProps {
  token: string;
  onUnauthorized: () => void;
}

export function SellerTab({ token, onUnauthorized }: SellerTabProps): JSX.Element {
  const [sellers, setSellers] = useState<SellerInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSellers = useCallback(() => {
    fetchMySellers(token)
      .then((list) => {
        setSellers(list);
        setSelected((prev) => prev ?? list[0]?.sellerId ?? null);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return onUnauthorized();
        setError(err instanceof Error ? err.message : 'Failed to load your APIs');
      });
  }, [token, onUnauthorized]);

  useEffect(loadSellers, [loadSellers]);

  const { data, loading, error: usageError, reload } = useUsage(selected);
  const { events, status } = useLiveFeed(selected, reload);

  return (
    <div className="tab-content">
      <RegisterApiForm token={token} onCreated={loadSellers} onUnauthorized={onUnauthorized} />

      {error && <ErrorBanner message={error} />}

      {sellers === null ? (
        <div className="card panel">
          <CardSkeleton rows={3} />
        </div>
      ) : sellers.length === 0 ? (
        <EmptyState message="No APIs yet. Register one above to start earning." />
      ) : (
        <div className="card panel">
          <label className="field">
            <span>Select an API</span>
            <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {sellers.map((seller) => (
                <option key={seller.sellerId} value={seller.sellerId}>
                  {seller.name} · {seller.priceAmount} {seller.priceAsset}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {selected && (
        <>
          {usageError ? (
            <ErrorBanner message={usageError} />
          ) : loading && !data ? (
            <div className="card panel">
              <CardSkeleton rows={4} />
              <Spinner />
            </div>
          ) : data ? (
            <>
              <SummaryCards summary={data.summary} />
              <div className="grid">
                <TopEndpoints endpoints={data.endpoints} />
                <WalletTable wallets={data.wallets} />
              </div>
              <LiveFeed events={events} status={status} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
