/**
 * Public surface of the gateway package: the app factory, resource factories,
 * the XRPL service, and the shared verify/settle routines (reused by later
 * facilitator endpoints and the middleware in US-005/US-007).
 */
export { buildApp } from './app.js';
export { createPool } from './db/pool.js';
export { createRedis } from './redis/client.js';
export { XrplService } from './services/xrpl.service.js';
export { issueChallenge } from './services/challenge.service.js';
export { settle, verify } from './services/settle.service.js';
export { verifyPayPerCall } from './services/verify.service.js';
export type { SettleOutcome, SettleDeps } from './services/settle.service.js';
export type { VerifyContext, VerifyResult } from './services/verify.service.js';
export type { GatewayDeps } from './deps.js';
export { sellerGatewayUrl } from './deps.js';
