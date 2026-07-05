/**
 * Register a new origin API (seller) in PROXY mode. On success the gateway
 * returns the working gateway URL to hand to callers.
 */
import { useState } from 'react';
import { Asset, PaymentMode } from '@app/shared';
import { createApi, UnauthorizedError, type CreateSellerInput } from '../api.js';
import { paymentModeLabel } from '../format.js';
import { Spinner } from './States.js';

interface RegisterApiFormProps {
  token: string;
  onCreated: () => void;
  onUnauthorized: () => void;
}

const EMPTY: CreateSellerInput = {
  name: '',
  originUrl: '',
  payToAddress: '',
  priceAmount: '',
  priceAsset: Asset.XRP,
  paymentMode: PaymentMode.PAY_PER_CALL,
};

export function RegisterApiForm({
  token,
  onCreated,
  onUnauthorized,
}: RegisterApiFormProps): JSX.Element {
  const [form, setForm] = useState<CreateSellerInput>(EMPTY);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [gatewayUrl, setGatewayUrl] = useState<string | null>(null);

  function set<K extends keyof CreateSellerInput>(key: K, value: CreateSellerInput[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setGatewayUrl(null);
    try {
      const result = await createApi(token, form);
      setGatewayUrl(result.gatewayUrl);
      setForm(EMPTY);
      onCreated();
    } catch (err) {
      if (err instanceof UnauthorizedError) return onUnauthorized();
      setError(err instanceof Error ? err.message : 'Failed to register API');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card panel">
      <h2>Register an API</h2>
      <p className="panel-sub">
        Point the gateway at your origin and set a per-call price. You get a proxy URL — zero origin
        code change.
      </p>
      <form className="form-grid" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Weather API"
            required
          />
        </label>
        <label className="field">
          <span>Origin URL</span>
          <input
            value={form.originUrl}
            onChange={(e) => set('originUrl', e.target.value)}
            placeholder="https://api.example.com"
            type="url"
            required
          />
        </label>
        <label className="field">
          <span>Pay-to address</span>
          <input
            value={form.payToAddress}
            onChange={(e) => set('payToAddress', e.target.value)}
            placeholder="rYourXRPLAddress…"
            spellCheck={false}
            required
          />
        </label>
        <label className="field field-narrow">
          <span>Price</span>
          <input
            value={form.priceAmount}
            onChange={(e) => set('priceAmount', e.target.value)}
            placeholder="0.01"
            inputMode="decimal"
            required
          />
        </label>
        <label className="field field-narrow">
          <span>Asset</span>
          <select value={form.priceAsset} onChange={(e) => set('priceAsset', e.target.value as Asset)}>
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
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? <Spinner /> : 'Register API'}
          </button>
        </div>
      </form>
      {error && <p className="login-error">{error}</p>}
      {gatewayUrl && (
        <p className="form-success">
          Registered. Gateway URL: <code>{gatewayUrl}</code>
        </p>
      )}
    </div>
  );
}
