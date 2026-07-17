/**
 * The headline demo: an autonomous agent that pays for an API per call over
 * x402. It opens a PayChan channel once, makes many metered calls off-ledger
 * (credits tick down, no per-call on-chain wait), then makes one pay-per-call
 * request that settles on chain — printing the explorer URL as proof.
 *
 * Every payment goes through the exact same `x402fetch` path any x402 client
 * uses against a middleware-metered API; the agent adds only the tool-calling
 * orchestration.
 */
import { Client, Wallet, dropsToXrp, xrpToDrops } from 'xrpl';
import { loadWallet, ensureConnected, openChannel } from '@xrpl-x402/client';
import type { ChannelHandle, X402Config } from '@xrpl-x402/client';
import { SettleResult } from '@app/shared';
import { createPaidFetchTool } from './tool.js';
import { DEMO_ASSET } from './config.js';
import type { AgentConfig } from './config.js';

/** Seller fields the agent reads from the gateway to open a channel. */
interface SellerInfo {
  payToAddress: string;
  /** Where to open the PayChan channel — always the gateway, which redeems claims. */
  channelDestination: string;
  /** The seller's own API base URL (its routes are metered by x402 middleware). */
  originUrl: string;
  priceAsset: string;
}

/** Fetch the registered seller's payTo address + service URL from the gateway. */
async function fetchSeller(config: AgentConfig): Promise<SellerInfo> {
  const response = await fetch(`${config.gatewayUrl}/sellers/${config.sellerId}`);
  if (!response.ok) throw new Error(`could not load seller ${config.sellerId} (${response.status})`);
  return (await response.json()) as SellerInfo;
}

/** Register a freshly opened channel with the gateway as a credits source. */
async function registerChannel(
  config: AgentConfig,
  channel: ChannelHandle,
  walletAddress: string,
): Promise<void> {
  const response = await fetch(`${config.gatewayUrl}/channels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channelId: channel.channelId,
      sellerId: config.sellerId,
      walletAddress,
    }),
  });
  if (!response.ok) {
    throw new Error(`gateway rejected channel registration (${response.status})`);
  }
}

/** Remaining channel credits, in XRP, for human-readable logging. */
function remainingXrp(channel: ChannelHandle): string {
  const remaining = BigInt(channel.depositDrops) - BigInt(channel.cumulativeDrops);
  return String(dropsToXrp(remaining.toString()));
}

/**
 * Run the full agent demo against an already-connected XRPL client. Returns the
 * on-chain pay-per-call settlement so callers (or tests) can assert on it.
 */
export async function runAgentDemo(
  config: AgentConfig,
  client: Client,
  wallet: Wallet,
): Promise<{ explorerUrl?: string; txHash?: string }> {
  const seller = await fetchSeller(config);
  const resourceBase = seller.originUrl;

  console.log(`Agent ${wallet.classicAddress} buying from seller ${config.sellerId}`);
  console.log(`Opening a channel with ${config.depositXrp} XRP deposit…`);

  const channel = await openChannel({
    client,
    wallet,
    destination: seller.channelDestination,
    deposit: config.depositXrp,
    sourceTag: config.sourceTag,
  });
  await registerChannel(config, channel, wallet.classicAddress);
  console.log(`Channel ${channel.channelId} open. Credits: ${config.depositXrp} XRP.\n`);

  // --- Off-ledger metered calls over the channel ---
  const creditsConfig: X402Config = {
    wallet,
    client,
    sourceTag: config.sourceTag,
    preferAsset: DEMO_ASSET,
    channel,
  };
  const creditsTool = createPaidFetchTool({ resourceBase, x402: creditsConfig });
  const resourcePath = config.resource.replace(/^\/+/, '');

  for (let call = 1; call <= config.meteredCalls; call += 1) {
    const result = await creditsTool.invoke({ path: resourcePath });
    // The gateway attaches a settlement header to every paid response; only a
    // tx hash means the call settled on chain instead of via off-ledger credits.
    if (result.settlement?.txHash) {
      throw new Error(`call ${call} unexpectedly settled on-chain instead of via credits`);
    }
    console.log(
      `  call ${String(call).padStart(2, '0')}/${config.meteredCalls} → ${result.status} · credits left ${remainingXrp(channel)} XRP`,
    );
  }
  console.log(`\n${config.meteredCalls} metered calls done off-ledger — no per-call on-chain tx.\n`);

  // --- One pay-per-call request that settles on chain ---
  console.log('Making one pay-per-call request to prove on-chain settlement…');
  const onchainConfig: X402Config = {
    wallet,
    client,
    sourceTag: config.sourceTag,
    preferAsset: DEMO_ASSET,
  };
  const onchainTool = createPaidFetchTool({ resourceBase, x402: onchainConfig });
  const onchain = await onchainTool.invoke({ path: resourcePath });

  const settlement = onchain.settlement;
  if (!settlement || settlement.result !== SettleResult.SETTLED) {
    throw new Error(`pay-per-call did not settle: ${settlement?.reason ?? 'no settlement header'}`);
  }
  console.log(`Settled on chain: ${settlement.txHash}`);
  if (settlement.explorerUrl) console.log(`Explorer: ${settlement.explorerUrl}`);

  return { explorerUrl: settlement.explorerUrl, txHash: settlement.txHash };
}

/** Connect a wallet + client from config, useful for the CLI entry point. */
export async function connectAgent(config: AgentConfig): Promise<{ client: Client; wallet: Wallet }> {
  const wallet = loadWallet(config.seed);
  const client = new Client(config.xrplEndpoint);
  await ensureConnected(client);
  // Touch xrpToDrops so the demo fails fast on a malformed deposit amount.
  xrpToDrops(config.depositXrp);
  return { client, wallet };
}
