/**
 * Seller dashboard (Vite + React). The full UI is built in US-006; this
 * skeleton keeps the package in the workspace build graph and proves the
 * shared contract resolves.
 */
import { Asset } from '@app/shared';

/** Assets the dashboard renders revenue for. */
export const DISPLAYED_ASSETS: readonly Asset[] = [Asset.RLUSD, Asset.XRP];
