/**
 * "My Bots" tab: create self-custody paying agents and manage the ones you have
 * (download config, copy run command, monitor spend, delete).
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchMyBots, UnauthorizedError, type Bot } from '../api.js';
import { BotForm } from './BotForm.js';
import { BotCard } from './BotCard.js';
import { CardSkeleton, EmptyState, ErrorBanner } from './States.js';

interface BotTabProps {
  token: string;
  onUnauthorized: () => void;
}

export function BotTab({ token, onUnauthorized }: BotTabProps): JSX.Element {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchMyBots(token)
      .then(setBots)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return onUnauthorized();
        setError(err instanceof Error ? err.message : 'Failed to load bots');
      });
  }, [token, onUnauthorized]);

  useEffect(load, [load]);

  return (
    <div className="tab-content">
      <BotForm token={token} onCreated={load} onUnauthorized={onUnauthorized} />

      {error && <ErrorBanner message={error} />}

      {bots === null ? (
        <div className="card panel">
          <CardSkeleton rows={3} />
        </div>
      ) : bots.length === 0 ? (
        <EmptyState message="No bots yet. Create one above to generate a runnable agent config." />
      ) : (
        <div className="bot-grid">
          {bots.map((bot) => (
            <BotCard
              key={bot.id}
              token={token}
              bot={bot}
              onDeleted={load}
              onUnauthorized={onUnauthorized}
            />
          ))}
        </div>
      )}
    </div>
  );
}
