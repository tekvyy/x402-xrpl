/**
 * Seller selector: the gateway exposes no seller-list endpoint (hackathon
 * scope), so the seller is chosen by pasting its id. The choice is validated
 * against `GET /sellers/:id`, resolved to the seller's name, and persisted.
 */
import { useEffect, useState } from 'react';
import { ApiError, fetchSeller, type SellerInfo } from '../api.js';
import { Spinner } from './States.js';

interface SellerSelectorProps {
  sellerId: string | null;
  onSelect: (seller: SellerInfo) => void;
}

export function SellerSelector({ sellerId, onSelect }: SellerSelectorProps): JSX.Element {
  const [input, setInput] = useState<string>(sellerId ?? '');
  const [seller, setSeller] = useState<SellerInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve a persisted / freshly-entered seller id to its record on mount and
  // whenever the active seller changes from outside.
  useEffect(() => {
    if (!sellerId) {
      setSeller(null);
      return;
    }
    setInput(sellerId);
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchSeller(sellerId, controller.signal)
      .then((info) => {
        setSeller(info);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSeller(null);
        setLoading(false);
        setError(describeError(err));
      });
    return () => controller.abort();
  }, [sellerId]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const id = input.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const info = await fetchSeller(id);
      setSeller(info);
      onSelect(info);
    } catch (err) {
      setSeller(null);
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="seller-selector">
      <form className="seller-form" onSubmit={submit}>
        <input
          className="seller-input"
          type="text"
          placeholder="Seller id (UUID)"
          value={input}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setInput(e.target.value)}
          aria-label="Seller id"
        />
        <button className="btn" type="submit" disabled={loading || input.trim() === ''}>
          {loading ? <Spinner /> : 'Load'}
        </button>
      </form>
      {error && <span className="seller-error">{error}</span>}
      {seller && !error && (
        <span className="seller-active">
          <span className="dot" /> {seller.name}
        </span>
      )}
    </div>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return 'No seller with that id';
  if (err instanceof Error) return err.message;
  return 'Failed to load seller';
}
