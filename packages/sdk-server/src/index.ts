/**
 * Server SDK: `x402` middleware for Express and Fastify — the integration
 * path for sellers. A seller prices their own routes by dropping one of these
 * in front of a handler; all verify/settle logic is delegated to the gateway
 * facilitator, so there is no duplicated x402 protocol code here.
 */
export { x402Express } from './express.js';
export { x402Fastify } from './fastify.js';
export { decide, PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER } from './core.js';
export type { X402Decision } from './core.js';
export type { X402MiddlewareOptions, ResourceResolver } from './types.js';
