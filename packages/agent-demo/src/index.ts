/**
 * AI agent demo (US-007): an autonomous agent that pays for an API per call via
 * x402 — opening a PayChan channel, spending credits off-ledger, then settling
 * one pay-per-call request on chain. The paid-fetch tool is reusable in any
 * MCP/LangChain host; all x402 logic is reused from `@app/sdk-client`.
 */
import { PaymentMode } from '@app/shared';
import { PAYMENT_HEADER } from '@app/sdk-client';

export { createPaidFetchTool, PaidFetchArgsSchema } from './tool.js';
export type { AgentTool, PaidFetchArgs, PaidFetchResult, PaidFetchToolOptions } from './tool.js';
export { runAgentDemo, connectAgent } from './agent.js';
export { loadAgentConfig, DEMO_ASSET } from './config.js';
export type { AgentConfig } from './config.js';

/** The agent's fast path uses prepaid credits over a payment channel. */
export const AGENT_PRIMARY_MODE: PaymentMode = PaymentMode.PREPAID_CREDITS;

export { PAYMENT_HEADER };
