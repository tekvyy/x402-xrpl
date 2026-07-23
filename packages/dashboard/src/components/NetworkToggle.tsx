/**
 * Network switch. The set of networks comes from the gateway (`/catalog`), so
 * the dashboard offers exactly what the deployment serves — no build-time env.
 * The choice drives which network the wallet connects to for sign-in and the
 * default used across the UI; it is persisted by the `network` store.
 *
 * Renders nothing until the gateway's networks are known, and renders a static
 * label (not a toggle) when only one network is served.
 */
import { useEffect, useState } from 'react';
import { XrplNetwork } from '@app/shared';
import { fetchCatalog } from '../api.js';
import { useNetwork } from '../network.js';

const LABEL: Record<XrplNetwork, string> = {
  [XrplNetwork.TESTNET]: 'Testnet',
  [XrplNetwork.MAINNET]: 'Mainnet',
};

export function NetworkToggle(): JSX.Element | null {
  const { network, setNetwork } = useNetwork();
  const [available, setAvailable] = useState<XrplNetwork[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((catalog) => {
        if (cancelled) return;
        setAvailable(catalog.networks);
        // Keep the selection valid for what the gateway actually serves: if the
        // persisted network is no longer offered, snap to the first available.
        if (catalog.networks.length > 0 && !catalog.networks.includes(network)) {
          setNetwork(catalog.networks[0]!);
        }
      })
      .catch(() => {
        if (!cancelled) setAvailable([]);
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount; the reconciliation above reads the latest `network`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!available || available.length === 0) return null;

  if (available.length === 1) {
    const only = available[0]!;
    return (
      <span
        className={`net-badge net-badge-${only.toLowerCase()}`}
        title="Network this gateway serves"
      >
        {LABEL[only]}
      </span>
    );
  }

  return (
    <div className="net-toggle" role="group" aria-label="XRPL network">
      {available.map((option) => (
        <button
          key={option}
          type="button"
          className={`net-toggle-btn ${option === network ? 'net-toggle-active' : ''} net-toggle-${option.toLowerCase()}`}
          aria-pressed={option === network}
          onClick={() => setNetwork(option)}
        >
          {LABEL[option]}
        </button>
      ))}
    </div>
  );
}
