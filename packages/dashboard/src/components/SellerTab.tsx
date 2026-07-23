/**
 * "My APIs" tab: register origin APIs, pick one, and watch its live revenue,
 * usage, and settlement feed (the original seller dashboard, now scoped to the
 * signed-in owner's sellers).
 */
import { useCallback, useEffect, useState } from 'react';
import { XrplNetwork } from '@app/shared';
import { fetchMySellers, UnauthorizedError, type SellerInfo } from '../api.js';
import { paymentSetupLabel } from '../format.js';
import { useNetwork } from '../network.js';
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
  // Each network is its own experience: only this network's APIs are shown.
  const { network } = useNetwork();

  const loadSellers = useCallback(() => {
    fetchMySellers(token)
      .then(setSellers)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return onUnauthorized();
        setError(err instanceof Error ? err.message : 'Failed to load your APIs');
      });
  }, [token, onUnauthorized]);

  useEffect(loadSellers, [loadSellers]);

  const visible = (sellers ?? []).filter((seller) => seller.networks.includes(network));

  // Keep the selection on a seller that exists in the current network's list;
  // snap to its first entry after a load or a network switch.
  useEffect(() => {
    setSelected((prev) =>
      prev && visible.some((seller) => seller.sellerId === prev)
        ? prev
        : (visible[0]?.sellerId ?? null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellers, network]);

  const { data, loading, error: usageError, reload } = useUsage(token, selected);
  const { events, status } = useLiveFeed(token, selected, reload);

  return (
    <div className="tab-content">
      <RegisterApiForm token={token} onCreated={loadSellers} onUnauthorized={onUnauthorized} />

      {error && <ErrorBanner message={error} />}

      {sellers === null ? (
        <div className="card panel">
          <CardSkeleton rows={3} />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          message={`No APIs on ${network === XrplNetwork.MAINNET ? 'Mainnet' : 'Testnet'} yet. Register one above to start earning.`}
        />
      ) : (
        <div className="card panel">
          <label className="field">
            <span>Select an API</span>
            <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {visible.map((seller) => (
                <option key={seller.sellerId} value={seller.sellerId}>
                  {seller.name} · {seller.priceAmount} {seller.priceAsset} ·{' '}
                  {paymentSetupLabel(seller.paymentMode)}
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
