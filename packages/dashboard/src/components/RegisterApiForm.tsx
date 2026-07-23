/**
 * Register a new API (seller). On success the gateway returns the seller id
 * to plug into the `@xrpl-x402/server` middleware, which meters the seller's
 * own routes and delegates verify/settle to the gateway.
 */
import { useEffect, useState } from 'react';
import { Asset, PaymentSetup, XrplNetwork } from '@app/shared';
import { createApi, fetchCatalog, UnauthorizedError, type CreateSellerInput } from '../api.js';
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

/** Buyer-facing wording for each network, so "testnet" reads as "free to try". */
const NETWORK_LABELS: Record<XrplNetwork, { title: string; detail: string }> = {
  [XrplNetwork.TESTNET]: {
    title: 'Testnet',
    detail: 'Free to call with faucet XRP. Use this to try the integration.',
  },
  [XrplNetwork.MAINNET]: {
    title: 'Mainnet',
    detail: 'Real XRP. Callers pay you for real.',
  },
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
  // Which networks this gateway actually serves. Offering a network it does not
  // serve would just produce a 400 on submit, so the picker mirrors the gateway.
  const [available, setAvailable] = useState<XrplNetwork[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setAvailable(catalog.networks);
        // Preselect testnet when offered: the safe default is the one that
        // cannot cost the seller's callers real money.
        const preferred = catalog.networks.includes(XrplNetwork.TESTNET)
          ? [XrplNetwork.TESTNET]
          : catalog.networks.slice(0, 1);
        setForm((prev) => (prev.networks.length === 0 ? { ...prev, networks: preferred } : prev));
      })
      .catch(() => {
        // Non-fatal: the gateway validates networks on submit anyway.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleNetwork(network: XrplNetwork): void {
    setForm((prev) => ({
      ...prev,
      networks: prev.networks.includes(network)
        ? prev.networks.filter((n) => n !== network)
        : [...prev.networks, network],
    }));
  }

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
    if (form.networks.length === 0) {
      setError('Pick at least one network for callers to pay on.');
      return;
    }
    setLoading(true);
    setError(null);
    setSellerId(null);
    try {
      const result = await createApi(token, form);
      setSellerId(result.sellerId);
      setForm({ ...EMPTY, networks: form.networks });
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
          <legend>Networks callers can pay on</legend>
          {available.length === 0 && <span className="setup-detail">Loading networks…</span>}
          {available.map((network) => (
            <label key={network} className="setup-option">
              <input
                type="checkbox"
                name="networks"
                value={network}
                checked={form.networks.includes(network)}
                onChange={() => toggleNetwork(network)}
              />
              <span className="setup-title">{NETWORK_LABELS[network].title}</span>
              <span className="setup-detail">{NETWORK_LABELS[network].detail}</span>
            </label>
          ))}
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
