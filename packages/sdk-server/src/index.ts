/**
 * Server SDK: `x402` middleware for Express and Fastify (US-007). A seller who
 * prefers code over the proxy prices their own routes by dropping one of these
 * in front of a handler; all verify/settle logic is delegated to the gateway
 * facilitator, so there is no duplicated x402 protocol code here.
 */
import { IntegrationMode } from '@app/shared';

export { x402Express } from './express.js';
export { x402Fastify } from './fastify.js';
export { decide, PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER } from './core.js';
export type { X402Decision } from './core.js';
export type { X402MiddlewareOptions, ResourceResolver } from './types.js';

/** This SDK targets the middleware integration path. */
export const INTEGRATION_MODE: IntegrationMode = IntegrationMode.MIDDLEWARE;
