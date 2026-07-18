/**
 * Create a self-custody bot: save which seller to buy from, the bot's public
 * paying address, spend caps, and run parameters. The gateway stores the config
 * (never a seed) and can then generate a runnable `.env`.
 */
import { useState } from 'react';
import { Asset, PaymentMode } from '@app/shared';
import { createBot, UnauthorizedError, type CreateBotInput } from '../api.js';
import { paymentModeLabel } from '../format.js';
import { Spinner } from './States.js';

interface BotFormProps {
  token: string;
  onCreated: () => void;
  onUnauthorized: () => void;
}

interface FormState {
  label: string;
  sellerId: string;
  walletAddress: string;
  asset: Asset;
  paymentMode: PaymentMode;
  resource: string;
  maxAmount: string;
  depositAmount: string;
  meteredCalls: string;
}

const EMPTY: FormState = {
  label: '',
  sellerId: '',
  walletAddress: '',
  asset: Asset.XRP,
  paymentMode: PaymentMode.PREPAID_CREDITS,
  resource: '/data',
  maxAmount: '',
  depositAmount: '',
  meteredCalls: '20',
};

export function BotForm({ token, onCreated, onUnauthorized }: BotFormProps): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const credits = form.paymentMode === PaymentMode.PREPAID_CREDITS;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const input: CreateBotInput = {
      label: form.label,
      sellerId: form.sellerId.trim(),
      walletAddress: form.walletAddress.trim(),
      asset: form.asset,
      paymentMode: form.paymentMode,
      resource: form.resource.trim() || '/data',
      meteredCalls: Number(form.meteredCalls) || 20,
      ...(form.maxAmount.trim() ? { maxAmount: form.maxAmount.trim() } : {}),
      ...(credits && form.depositAmount.trim() ? { depositAmount: form.depositAmount.trim() } : {}),
    };
    try {
      await createBot(token, input);
      setForm(EMPTY);
      onCreated();
    } catch (err) {
      if (err instanceof UnauthorizedError) return onUnauthorized();
      setError(err instanceof Error ? err.message : 'Failed to create bot');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card panel">
      <h2>New bot</h2>
      <p className="panel-sub">
        Configure a paying agent. Its seed stays with you — download the generated <code>.env</code>{' '}
        and run it yourself.
      </p>
      <form className="form-grid" onSubmit={submit}>
        <label className="field">
          <span>Label</span>
          <input
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder="Weather poller"
            required
          />
        </label>
        <label className="field">
          <span>Seller id (who you buy from)</span>
          <input
            value={form.sellerId}
            onChange={(e) => set('sellerId', e.target.value)}
            placeholder="UUID of the target API"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span>Bot wallet address</span>
          <input
            value={form.walletAddress}
            onChange={(e) => set('walletAddress', e.target.value)}
            placeholder="rBotPublicAddress… (never the seed)"
            spellCheck={false}
            required
          />
        </label>
        <label className="field field-narrow">
          <span>Asset</span>
          <select value={form.asset} onChange={(e) => set('asset', e.target.value as Asset)}>
            {Object.values(Asset).map((asset) => (
              <option key={asset} value={asset}>
                {asset}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-narrow">
          <span>Mode</span>
          <select
            value={form.paymentMode}
            onChange={(e) => set('paymentMode', e.target.value as PaymentMode)}
          >
            {Object.values(PaymentMode).map((mode) => (
              <option key={mode} value={mode}>
                {paymentModeLabel(mode)}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-narrow">
          <span>Resource path</span>
          <input
            value={form.resource}
            onChange={(e) => set('resource', e.target.value)}
            placeholder="/data"
          />
        </label>
        <label className="field field-narrow">
          <span>Max / call</span>
          <input
            value={form.maxAmount}
            onChange={(e) => set('maxAmount', e.target.value)}
            placeholder="optional"
            inputMode="decimal"
          />
        </label>
        {credits && (
          <label className="field field-narrow">
            <span>Deposit (XRP)</span>
            <input
              value={form.depositAmount}
              onChange={(e) => set('depositAmount', e.target.value)}
              placeholder="1"
              inputMode="decimal"
              required
            />
          </label>
        )}
        <label className="field field-narrow">
          <span>Metered calls</span>
          <input
            value={form.meteredCalls}
            onChange={(e) => set('meteredCalls', e.target.value)}
            inputMode="numeric"
          />
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? <Spinner /> : 'Create bot'}
          </button>
        </div>
      </form>
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}
