/**
 * Register a new API (seller). On success the gateway returns the seller id
 * to plug into the `@xrpl-x402/server` middleware, which meters the seller's
 * own routes and delegates verify/settle to the gateway.
 */
import { useState } from 'react';
import { Asset, PaymentSetup, XrplNetwork } from '@app/shared';
import { createApi, UnauthorizedError, type CreateSellerInput } from '../api.js';
import { useNetwork } from '../network.js';
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
  paymentMode: PaymentSetup.PAY_PER_CALL,
  networks: [],
};

/** Buyer-facing wording per network, so "testnet" reads as "free to try". */
const NETWORK_DETAIL: Record<XrplNetwork, string> = {
  [XrplNetwork.TESTNET]: 'Free to call with faucet XRP. Use this to try the integration.',
  [XrplNetwork.MAINNET]: 'Real XRP. Callers pay you for real.',
};

/** The two seller setups plus the combined one, with buyer-facing wording. */
const SETUP_OPTIONS: Array<{ value: PaymentSetup; title: string; detail: string }> = [
  {
    value: PaymentSetup.PAY_PER_CALL,
    title: 'Pay-per-call',
    detail: 'Traditional: one on-chain payment per request. XRP or RLUSD.',
  },
  {
    value: PaymentSetup.PREPAID_CREDITS,
    title: 'Prepaid credits',
    detail: 'Callers fund a payment channel once, then spend it per call off-ledger. XRP only.',
  },
  {
    value: PaymentSetup.BOTH,
    title: 'Both',
    detail: 'Agents use credits for speed; one-off callers pay per call. XRP only.',
  },
];

export function RegisterApiForm({
  token,
  onCreated,
  onUnauthorized,
}: RegisterApiFormProps): JSX.Element {
  const [form, setForm] = useState<CreateSellerInput>(EMPTY);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [sellerId, setSellerId] = useState<string | null>(null);
  // Each network is its own experience: the API registers on the network
  // selected in the header toggle, nowhere else.
  const { network } = useNetwork();

  function set<K extends keyof CreateSellerInput>(key: K, value: CreateSellerInput[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // PayChan is XRP-native: any setup that accepts credits locks pricing to XRP.
  const creditsSetup = form.paymentMode !== PaymentSetup.PAY_PER_CALL;

  function setSetup(setup: PaymentSetup): void {
    setForm((prev) => ({
      ...prev,
      paymentMode: setup,
      priceAsset: setup === PaymentSetup.PAY_PER_CALL ? prev.priceAsset : Asset.XRP,
    }));
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSellerId(null);
    try {
      const result = await createApi(token, { ...form, networks: [network] });
      setSellerId(result.sellerId);
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
        Set a per-call price and payout address, then drop the <code>@xrpl-x402/server</code>{' '}
        middleware into your API — it charges callers via this gateway; pricing lives here.
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
          <span>API base URL (public)</span>
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
          <select
            value={form.priceAsset}
            onChange={(e) => set('priceAsset', e.target.value as Asset)}
          >
            {Object.values(Asset).map((asset) => (
              <option key={asset} value={asset} disabled={asset === Asset.RLUSD && creditsSetup}>
                {asset}
                {asset === Asset.RLUSD && creditsSetup ? ' (pay-per-call only)' : ''}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="setup-picker">
          <legend>Network callers pay on</legend>
          <div className="setup-option">
            <span className="setup-title">
              {network === XrplNetwork.MAINNET ? 'Mainnet' : 'Testnet'}
            </span>
            <span className="setup-detail">
              {NETWORK_DETAIL[network]} Switch networks with the toggle in the header.
            </span>
          </div>
        </fieldset>
        <fieldset className="setup-picker">
          <legend>How callers pay</legend>
          {SETUP_OPTIONS.map((option) => (
            <label key={option.value} className="setup-option">
              <input
                type="radio"
                name="payment-setup"
                value={option.value}
                checked={form.paymentMode === option.value}
                onChange={() => setSetup(option.value)}
              />
              <span className="setup-title">{option.title}</span>
              <span className="setup-detail">{option.detail}</span>
            </label>
          ))}
        </fieldset>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? <Spinner /> : 'Register API'}
          </button>
        </div>
      </form>
      {error && <p className="login-error">{error}</p>}
      {sellerId && (
        <p className="form-success">
          Registered. Add the middleware to your server with seller id <code>{sellerId}</code>:{' '}
          <code>x402Fastify(&#123; gatewayUrl, sellerId &#125;)</code> (or <code>x402Express</code>)
          from <code>@xrpl-x402/server</code> — pricing stays here, your routes stay yours.
        </p>
      )}
    </div>
  );
}
