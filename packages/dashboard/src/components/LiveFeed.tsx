/**
 * Real-time settlement feed. Each row shows the payer, endpoint, amount, mode,
 * and — for on-chain settlements — a link to the XRPL explorer.
 */
import { explorerTxUrl } from '@app/shared';
import type { UsageStreamEvent } from '../api.js';
import type { FeedStatus } from '../hooks/useLiveFeed.js';
import {
  formatAmount,
  formatDateTime,
  formatTime,
  paymentModeLabel,
  shortenAddress,
  shortenHash,
} from '../format.js';
import { EmptyState } from './States.js';

/** One settlement row, shared by the live feed and the history panel. */
export function FeedRow({
  event,
  showDate = false,
}: {
  event: UsageStreamEvent;
  showDate?: boolean;
}): JSX.Element {
  return (
    <li className="feed-row">
      <span className="feed-time">
        {showDate ? formatDateTime(event.timestamp) : formatTime(event.timestamp)}
      </span>
      <span className="feed-main">
        <span className="mono feed-wallet" title={event.walletAddress}>
          {shortenAddress(event.walletAddress)}
        </span>
        <span className="feed-endpoint" title={event.endpoint}>
          {event.endpoint}
        </span>
      </span>
      <span className={`chip chip-${event.mode.toLowerCase()}`}>
        {paymentModeLabel(event.mode)}
      </span>
      <span className="feed-amount">{formatAmount(event.amount, event.asset)}</span>
      {event.txHash ? (
        <a
          className="feed-tx"
          href={explorerTxUrl(event.network, event.txHash)}
          target="_blank"
          rel="noreferrer"
          title={event.txHash}
        >
          {shortenHash(event.txHash)} ↗
        </a>
      ) : (
        <span className="feed-tx feed-tx-offledger" title="Off-ledger credit claim">
          off-ledger
        </span>
      )}
    </li>
  );
}

interface LiveFeedProps {
  events: UsageStreamEvent[];
  status: FeedStatus;
}

const STATUS_LABEL: Record<FeedStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  error: 'Reconnecting…',
};

export function LiveFeed({ events, status }: LiveFeedProps): JSX.Element {
  return (
    <section className="card panel live-feed">
      <div className="panel-head">
        <h2 className="panel-title">Live activity</h2>
        <span className={`feed-status feed-status-${status}`}>
          <span className="dot" /> {STATUS_LABEL[status]}
        </span>
      </div>
      {events.length === 0 ? (
        <EmptyState message="Waiting for the next settlement…" />
      ) : (
        <ul className="feed-list">
          {events.map((event) => (
            <FeedRow event={event} key={event.id} />
          ))}
        </ul>
      )}
    </section>
  );
}
