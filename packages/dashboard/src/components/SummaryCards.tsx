/** Headline metric cards: revenue per asset, total calls, active wallets. */
import type { UsageSummary } from '../api.js';
import { trimDecimal } from '../format.js';

export function SummaryCards({ summary }: { summary: UsageSummary }): JSX.Element {
  const revenue =
    summary.revenueByAsset.length > 0
      ? summary.revenueByAsset
      : // Render a zero card so the layout never collapses on a fresh seller.
        [{ asset: undefined, amount: '0', calls: 0 }];

  return (
    <div className="cards">
      {revenue.map((row, i) => (
        <div className="card metric" key={row.asset ?? `empty-${i}`}>
          <span className="metric-label">Revenue{row.asset ? ` · ${row.asset}` : ''}</span>
          <span className="metric-value">
            {trimDecimal(row.amount)}
            {row.asset && <span className="metric-unit"> {row.asset}</span>}
          </span>
          <span className="metric-sub">{row.calls} calls</span>
        </div>
      ))}
      <div className="card metric">
        <span className="metric-label">Total calls</span>
        <span className="metric-value">{summary.totalCalls}</span>
        <span className="metric-sub">across all endpoints</span>
      </div>
      <div className="card metric">
        <span className="metric-label">Active wallets</span>
        <span className="metric-value">{summary.activeWallets}</span>
        <span className="metric-sub">unique payers</span>
      </div>
    </div>
  );
}
