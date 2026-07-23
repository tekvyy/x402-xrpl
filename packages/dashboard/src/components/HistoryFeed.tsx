/**
 * Full settlement history for a seller, straight from the gateway's
 * usage_events audit table: every settled call ever recorded, newest first,
 * paged with a keyset cursor. Complements the live feed, which only shows
 * settlements that happened while the page was open.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchHistory, UnauthorizedError, type UsageStreamEvent } from '../api.js';
import { EmptyState, ErrorBanner, Spinner } from './States.js';
import { FeedRow } from './LiveFeed.js';

interface HistoryFeedProps {
  token: string;
  sellerId: string;
  onUnauthorized: () => void;
  /** Bumped by the parent when a live settlement lands, to refresh page one. */
  refreshKey?: number;
}

export function HistoryFeed({
  token,
  sellerId,
  onUnauthorized,
  refreshKey = 0,
}: HistoryFeedProps): JSX.Element {
  const [events, setEvents] = useState<UsageStreamEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFirstPage = useCallback(() => {
    const controller = new AbortController();
    fetchHistory(token, sellerId, undefined, controller.signal)
      .then((page) => {
        setEvents(page.events);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof UnauthorizedError) return onUnauthorized();
        setError(err instanceof Error ? err.message : 'Failed to load history');
      });
    return () => controller.abort();
  }, [token, sellerId, onUnauthorized]);

  useEffect(loadFirstPage, [loadFirstPage, refreshKey]);

  const loadMore = (): void => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    fetchHistory(token, sellerId, cursor)
      .then((page) => {
        setEvents((prev) => [...(prev ?? []), ...page.events]);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return onUnauthorized();
        setError(err instanceof Error ? err.message : 'Failed to load more history');
      })
      .finally(() => setLoadingMore(false));
  };

  return (
    <section className="card panel live-feed">
      <div className="panel-head">
        <h2 className="panel-title">History</h2>
        {events !== null && (
          <span className="feed-status">
            {events.length} call{events.length === 1 ? '' : 's'} loaded
          </span>
        )}
      </div>
      {error ? (
        <ErrorBanner message={error} />
      ) : events === null ? (
        <Spinner />
      ) : events.length === 0 ? (
        <EmptyState message="No settled calls yet." />
      ) : (
        <>
          <ul className="feed-list">
            {events.map((event) => (
              <FeedRow event={event} key={event.id} showDate />
            ))}
          </ul>
          {cursor && (
            <button className="btn" disabled={loadingMore} onClick={loadMore} type="button">
              {loadingMore ? 'Loading…' : 'Load older'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
