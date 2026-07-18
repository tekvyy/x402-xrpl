/**
 * The agent's payment tool: `x402fetch` wrapped as an MCP-style tool descriptor
 * (name + description + input schema + handler). An MCP or LangChain host can
 * expose this verbatim, letting an autonomous agent pay for an API call the same
 * way it would call any other tool. All x402 logic is reused from
 * `@xrpl-x402/client` — the tool adds only the tool-calling shape.
 */
import { z } from 'zod';
import { x402fetch, readSettlement } from '@xrpl-x402/client';
import type { X402Config } from '@xrpl-x402/client';
import type { SettlementResponse } from '@app/shared';

/** Arguments an agent supplies when invoking the paid-fetch tool. */
export const PaidFetchArgsSchema = z.object({
  /** Path (with optional query) under the seller's gateway URL. */
  path: z.string().min(1),
  /** HTTP method; defaults to GET. */
  method: z.string().optional(),
});
export type PaidFetchArgs = z.infer<typeof PaidFetchArgsSchema>;

/** What the tool returns to the agent after a (possibly paid) call. */
export interface PaidFetchResult {
  status: number;
  body: unknown;
  /** Settlement details when the call was paid on-chain (pay-per-call). */
  settlement?: SettlementResponse;
}

/** A minimal, MCP-compatible tool contract (name, description, schema, handler). */
export interface AgentTool<Args, Result> {
  name: string;
  description: string;
  inputSchema: z.ZodType<Args>;
  invoke(args: Args): Promise<Result>;
}

export interface PaidFetchToolOptions {
  /** The seller's API base URL (routes metered by x402 middleware). */
  resourceBase: string;
  /** x402 payment configuration (wallet, client, source tag, optional channel). */
  x402: X402Config;
}

/** Build the paid-fetch tool bound to a seller's API and a payment config. */
export function createPaidFetchTool(
  options: PaidFetchToolOptions,
): AgentTool<PaidFetchArgs, PaidFetchResult> {
  const base = options.resourceBase.replace(/\/+$/, '');

  return {
    name: 'paid_fetch',
    description:
      'Fetch a metered API resource, transparently paying the x402 charge in ' +
      'RLUSD or XRP (off-ledger channel credits when available, else per-call).',
    inputSchema: PaidFetchArgsSchema,
    async invoke(args: PaidFetchArgs): Promise<PaidFetchResult> {
      const path = `/${args.path.replace(/^\/+/, '')}`;
      const response = await x402fetch(`${base}${path}`, {
        method: args.method ?? 'GET',
        x402: options.x402,
      });

      const body = await readBody(response);
      const settlement = readSettlement(response);
      return settlement ? { status: response.status, body, settlement } : { status: response.status, body };
    },
  };
}

/** Decode a response body as JSON when possible, else as text. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
