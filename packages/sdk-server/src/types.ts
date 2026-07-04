/**
 * Configuration for the `x402` server middleware. Pricing (amount, asset,
 * payTo, mode) is *not* repeated here: it lives in the seller's gateway
 * registration, which is the single source of truth. The middleware only needs
 * to know which facilitator to talk to and which registered seller it prices
 * for — this is what "no duplicated x402 logic" (US-007 AC) buys us.
 */

/** How the middleware locates the resource path being priced, per request. */
export type ResourceResolver = (requestPath: string) => string;

export interface X402MiddlewareOptions {
  /** Facilitator base URL (the gateway), without a trailing slash. */
  gatewayUrl: string;
  /** The registered seller this middleware charges on behalf of. */
  sellerId: string;
  /**
   * Map an incoming request path to the `resource` recorded on the challenge.
   * Defaults to the request path verbatim.
   */
  resource?: ResourceResolver;
  /** Injectable `fetch` (defaults to the global) — primarily for testing. */
  fetchImpl?: typeof fetch;
}
