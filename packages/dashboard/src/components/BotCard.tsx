/**
 * One saved bot: its config summary, on-chain spend, and self-custody actions —
 * download a runnable `.env`, copy the run command, or delete it.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  deleteBot,
  fetchBot,
  fetchBotConfig,
  UnauthorizedError,
  type Bot,
  type BotWithUsage,
} from '../api.js';
import { formatAmount, paymentModeLabel, shortenAddress, trimDecimal } from '../format.js';

interface BotCardProps {
  token: string;
  bot: Bot;
  onDeleted: () => void;
  onUnauthorized: () => void;
}

export function BotCard({ token, bot, onDeleted, onUnauthorized }: BotCardProps): JSX.Element {
  const [detail, setDetail] = useState<BotWithUsage | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnauthorized = useCallback(() => onUnauthorized(), [onUnauthorized]);

  useEffect(() => {
    let active = true;
    fetchBot(token, bot.id)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return handleUnauthorized();
        if (active) setError('Could not load spend');
      });
    return () => {
      active = false;
    };
  }, [token, bot.id, handleUnauthorized]);

  async function download(): Promise<void> {
    setError(null);
    try {
      const config = await fetchBotConfig(token, bot.id);
      const blob = new Blob([config.env], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${bot.label.replace(/\s+/g, '-').toLowerCase() || 'bot'}.env`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof UnauthorizedError) return handleUnauthorized();
      setError('Could not generate config');
    }
  }

  async function copyRun(): Promise<void> {
    try {
      await navigator.clipboard.writeText('pnpm --filter @app/agent-demo start');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard unavailable');
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await deleteBot(token, bot.id);
      onDeleted();
    } catch (err) {
      if (err instanceof UnauthorizedError) return handleUnauthorized();
      setError('Could not delete');
      setBusy(false);
    }
  }

  return (
    <div className="card bot-card">
      <div className="bot-card-head">
        <h3>{bot.label}</h3>
        <span className={`chip chip-${bot.paymentMode.toLowerCase()}`}>
          {paymentModeLabel(bot.paymentMode)}
        </span>
      </div>

      <dl className="bot-meta">
        <div>
          <dt>Wallet</dt>
          <dd title={bot.walletAddress}>{shortenAddress(bot.walletAddress)}</dd>
        </div>
        <div>
          <dt>Resource</dt>
          <dd>{bot.resource}</dd>
        </div>
        <div>
          <dt>Max / call</dt>
          <dd>{bot.maxAmount ? formatAmount(bot.maxAmount, bot.asset) : '—'}</dd>
        </div>
        {bot.depositAmount && (
          <div>
            <dt>Deposit</dt>
            <dd>{formatAmount(bot.depositAmount, bot.asset)}</dd>
          </div>
        )}
        <div>
          <dt>Spent</dt>
          <dd>
            {detail
              ? `${trimDecimal(detail.usage.spend)} ${bot.asset} · ${detail.usage.calls} calls`
              : '…'}
          </dd>
        </div>
      </dl>

      <div className="bot-actions">
        <button className="btn" type="button" onClick={download}>
          Download .env
        </button>
        <button className="btn" type="button" onClick={copyRun}>
          {copied ? 'Copied!' : 'Copy run cmd'}
        </button>
        <button className="btn btn-danger" type="button" onClick={remove} disabled={busy}>
          Delete
        </button>
      </div>
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}
