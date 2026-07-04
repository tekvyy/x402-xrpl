/**
 * Seller dashboard shell. Resolves a persisted seller, loads the three
 * aggregate views, and layers a live SSE feed on top — new settlements both
 * append to the feed and trigger an in-place refresh of the aggregates.
 */
import { useCallback, useState } from 'react';
import type { SellerInfo } from './api.js';
import { SELLER_STORAGE_KEY } from './config.js';
import { SellerSelector } from './components/SellerSelector.js';
import { SummaryCards } from './components/SummaryCards.js';
import { TopEndpoints } from './components/TopEndpoints.js';
import { WalletTable } from './components/WalletTable.js';
import { LiveFeed } from './components/LiveFeed.js';
import { CardSkeleton, EmptyState, ErrorBanner } from './components/States.js';
import { useUsage } from './hooks/useUsage.js';
import { useLiveFeed } from './hooks/useLiveFeed.js';

function readStoredSeller(): string | null {
  try {
    return window.localStorage.getItem(SELLER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function App(): JSX.Element {
  const [sellerId, setSellerId] = useState<string | null>(readStoredSeller);

  const handleSelect = useCallback((seller: SellerInfo) => {
    setSellerId(seller.sellerId);
    try {
      window.localStorage.setItem(SELLER_STORAGE_KEY, seller.sellerId);
    } catch {
      // Non-fatal: persistence is a convenience, not a requirement.
    }
  }, []);

  const { data, loading, error, reload } = useUsage(sellerId);
  // A new settlement means the aggregates are stale — refresh them.
  const { events, status } = useLiveFeed(sellerId, reload);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">x402</span>
          <div className="brand-text">
            <h1>Seller Dashboard</h1>
            <p>XRPL x402 Monetization Gateway</p>
          </div>
        </div>
        <SellerSelector sellerId={sellerId} onSelect={handleSelect} />
      </header>

      <main className="app-main">
        {!sellerId ? (
          <EmptyState message="Enter a seller id to view revenue, usage, and the live tx feed." />
        ) : error ? (
          <ErrorBanner message={error} />
        ) : loading && !data ? (
          <DashboardSkeleton />
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
      </main>
    </div>
  );
}

function DashboardSkeleton(): JSX.Element {
  return (
    <>
      <div className="cards">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="card metric" key={i}>
            <CardSkeleton rows={2} />
          </div>
        ))}
      </div>
      <div className="grid">
        <div className="card panel">
          <CardSkeleton rows={5} />
        </div>
        <div className="card panel">
          <CardSkeleton rows={5} />
        </div>
      </div>
    </>
  );
}
