/**
 * Subscribes to a seller's `/usage/stream` SSE feed. New events are prepended
 * and the list is capped; the browser's EventSource reconnects automatically on
 * drop, and `onEvent` lets the caller refresh aggregates as settlements arrive.
 */
import { useEffect, useRef, useState } from 'react';
import { usageStreamUrl, type UsageStreamEvent } from '../api.js';
import { LIVE_FEED_CAP } from '../config.js';

export type FeedStatus = 'connecting' | 'live' | 'error';

export interface LiveFeedState {
  events: UsageStreamEvent[];
  status: FeedStatus;
}

export function useLiveFeed(
  token: string,
  sellerId: string | null,
  onEvent?: (event: UsageStreamEvent) => void,
): LiveFeedState {
  const [events, setEvents] = useState<UsageStreamEvent[]>([]);
  const [status, setStatus] = useState<FeedStatus>('connecting');
  // Keep the latest callback without resubscribing when it changes identity.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!sellerId) {
      setEvents([]);
      setStatus('connecting');
      return;
    }
    setEvents([]);
    setStatus('connecting');

    const source = new EventSource(usageStreamUrl(token, sellerId));

    source.onopen = () => setStatus('live');
    source.onmessage = (message: MessageEvent<string>) => {
      let event: UsageStreamEvent;
      try {
        event = JSON.parse(message.data) as UsageStreamEvent;
      } catch {
        return;
      }
      setEvents((prev) => [event, ...prev].slice(0, LIVE_FEED_CAP));
      onEventRef.current?.(event);
    };
    // EventSource auto-reconnects; surface the interim state to the UI.
    source.onerror = () => setStatus('error');

    return () => source.close();
  }, [token, sellerId]);

  return { events, status };
}
