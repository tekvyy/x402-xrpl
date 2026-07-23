/**
 * Create a self-custody bot: save which seller to buy from, the bot's public
 * paying address, spend caps, and run parameters. The gateway stores the config
 * (never a seed) and can then generate a runnable `.env`.
 *
 * The network is chosen per bot, not from any deployment-wide setting: a bot can
 * pay on any network the target seller advertises. When a valid seller id is
 * entered its payable networks are fetched and offered here.
 */
import { useEffect, useState } from 'react';
import { Asset, PaymentMode, XrplNetwork } from '@app/shared';
import { createBot, fetchSeller, UnauthorizedError, type CreateBotInput } from '../api.js';
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
  network: XrplNetwork | '';
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
  network: '',
  asset: Asset.XRP,
  paymentMode: PaymentMode.PREPAID_CREDITS,
  resource: '/data',
  maxAmount: '',
  depositAmount: '',
  meteredCalls: '20',
};

/** Buyer-facing labels so "testnet" reads as the free option. */
const NETWORK_LABEL: Record<XrplNetwork, string> = {
  [XrplNetwork.TESTNET]: 'Testnet (free, faucet XRP)',
  [XrplNetwork.MAINNET]: 'Mainnet (real XRP)',
};

export function BotForm({ token, onCreated, onUnauthorized }: BotFormProps): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Networks the entered seller can actually be paid on. Empty until a valid
  // seller id resolves; the network select is disabled until then.
  const [sellerNetworks, setSellerNetworks] = useState<XrplNetwork[]>([]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Resolve the target seller's payable networks whenever the seller id changes,
  // and keep the selected network valid for that seller.
  const sellerId = form.sellerId.trim();
  useEffect(() => {
    if (sellerId.length === 0) {
      setSellerNetworks([]);
      return;
    }
    const controller = new AbortController();
    fetchSeller(sellerId, controller.signal)
      .then((seller) => {
        const networks = seller.payableNetworks ?? [];
        setSellerNetworks(networks);
        // Auto-select when there is exactly one choice; otherwise drop a stale
        // selection the new seller can't accept.
        setForm((prev) => ({
          ...prev,
          network:
            networks.length === 1
              ? networks[0]!
              : prev.network && networks.includes(prev.network)
                ? prev.network
                : '',
        }));
      })
      .catch(() => {
        // Unknown/typo'd seller id: leave the picker empty; submit still guards.
        if (!controller.signal.aborted) setSellerNetworks([]);
      });
    return () => controller.abort();
  }, [sellerId]);

  const credits = form.paymentMode === PaymentMode.PREPAID_CREDITS;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (form.network === '') {
      setError('Pick the network this bot pays on.');
      return;
    }
    setLoading(true);
    setError(null);
    const input: CreateBotInput = {
      label: form.label,
      sellerId,
      walletAddress: form.walletAddress.trim(),
      network: form.network,
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
      setSellerNetworks([]);
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
          <span>Network</span>
          <select
            value={form.network}
            onChange={(e) => set('network', e.target.value as XrplNetwork)}
            disabled={sellerNetworks.length === 0}
            required
          >
            <option value="" disabled>
              {sellerNetworks.length === 0 ? 'enter a seller id first' : 'select network'}
            </option>
            {sellerNetworks.map((network) => (
              <option key={network} value={network}>
                {NETWORK_LABEL[network]}
              </option>
            ))}
          </select>
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
