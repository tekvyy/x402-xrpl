/** Per-wallet breakdown: call count + spend, sortable by either column. */
import { useMemo, useState } from 'react';
import type { WalletUsage } from '../api.js';
import { compareDecimalStrings, shortenAddress, trimDecimal } from '../format.js';
import { EmptyState } from './States.js';

type SortKey = 'calls' | 'spend';

export function WalletTable({ wallets }: { wallets: WalletUsage[] }): JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('spend');

  const sorted = useMemo(() => {
    const copy = [...wallets];
    copy.sort((a, b) =>
      sortKey === 'calls' ? b.calls - a.calls : compareDecimalStrings(b.spend, a.spend),
    );
    return copy;
  }, [wallets, sortKey]);

  return (
    <section className="card panel">
      <h2 className="panel-title">Per-wallet spend</h2>
      {wallets.length === 0 ? (
        <EmptyState message="No paying wallets yet." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Wallet</th>
              <th className="sortable num" onClick={() => setSortKey('calls')}>
                Calls{sortKey === 'calls' ? ' ▾' : ''}
              </th>
              <th className="sortable num" onClick={() => setSortKey('spend')}>
                Spend{sortKey === 'spend' ? ' ▾' : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((wallet) => (
              <tr key={wallet.walletAddress}>
                <td className="mono" title={wallet.walletAddress}>
                  {shortenAddress(wallet.walletAddress)}
                </td>
                <td className="num">{wallet.calls}</td>
                <td className="num">{trimDecimal(wallet.spend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
