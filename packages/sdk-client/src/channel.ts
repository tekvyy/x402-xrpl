/**
 * PayChan prepaid-credits helpers. An agent opens a channel to a seller once,
 * then spends credits off-ledger by signing monotonic claims — no per-call
 * on-chain wait. This is XRPL's native analog of Base x402's EIP-3009 gasless
 * authorizations. PayChan is XRP-native, so these helpers work in drops.
 */
import { Client, Wallet, dropsToXrp, signPaymentChannelClaim, xrpToDrops } from 'xrpl';
import type { PaymentChannelCreate, TransactionMetadataBase } from 'xrpl';
import { isCreatedNode } from 'xrpl';
import { ensureConnected } from './wallet.js';

/** Default settle delay (seconds) before an unclaimed channel can be closed. */
export const DEFAULT_SETTLE_DELAY = 86_400;

export interface OpenChannelParams {
  client: Client;
  wallet: Wallet;
  /** Seller's XRPL classic address (the channel destination). */
  sellerPayTo: string;
  /** Deposit in XRP (human units). */
  deposit: string;
  /** Team source tag stamped on the channel-create tx. */
  sourceTag: number;
  /** Override the settle delay (seconds); defaults to {@link DEFAULT_SETTLE_DELAY}. */
  settleDelay?: number;
}

/**
 * A live client-side view of an open channel. `cumulativeDrops` advances as
 * claims are signed and accepted, so successive claims stay strictly monotonic.
 */
export interface ChannelHandle {
  channelId: string;
  /** Total deposit, in drops. */
  depositDrops: string;
  /** Cumulative amount authorized so far, in drops (advances per accepted call). */
  cumulativeDrops: string;
  /** Channel signing public key (hex). */
  publicKey: string;
}

/**
 * Submit a source-tagged `PaymentChannelCreate` to `sellerPayTo` and return a
 * {@link ChannelHandle} for spending credits. The channel id is read from the
 * created ledger entry in the transaction metadata.
 */
export async function openChannel(params: OpenChannelParams): Promise<ChannelHandle> {
  const { client, wallet, sellerPayTo, deposit, sourceTag } = params;
  await ensureConnected(client);

  const depositDrops = xrpToDrops(deposit);
  const tx: PaymentChannelCreate = {
    TransactionType: 'PaymentChannelCreate',
    Account: wallet.classicAddress,
    Amount: depositDrops,
    Destination: sellerPayTo,
    SettleDelay: params.settleDelay ?? DEFAULT_SETTLE_DELAY,
    PublicKey: wallet.publicKey,
    SourceTag: sourceTag,
  };

  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  const channelId = extractChannelId(result.result.meta);
  if (!channelId) throw new Error('could not determine the channel id from the create tx');

  return { channelId, depositDrops, cumulativeDrops: '0', publicKey: wallet.publicKey };
}

/**
 * Sign a channel claim authorizing `cumulativeAmount` (drops). The gateway
 * verifies this signature against the channel's public key and redeems the
 * accumulated total on chain later.
 */
export function signClaim(wallet: Wallet, channelId: string, cumulativeDrops: string): string {
  const xrpAmount = String(dropsToXrp(cumulativeDrops));
  return signPaymentChannelClaim(channelId, xrpAmount, wallet.privateKey);
}

/** Whether `handle` still has room for another `priceDrops` charge. */
export function hasCredits(handle: ChannelHandle, priceDrops: string): boolean {
  return BigInt(handle.cumulativeDrops) + BigInt(priceDrops) <= BigInt(handle.depositDrops);
}

/** Extract the created PayChannel's ledger index (its channel id) from tx meta. */
function extractChannelId(meta: TransactionMetadataBase | string | undefined): string | undefined {
  if (!meta || typeof meta === 'string') return undefined;
  for (const node of meta.AffectedNodes) {
    if (isCreatedNode(node) && node.CreatedNode.LedgerEntryType === 'PayChannel') {
      return node.CreatedNode.LedgerIndex;
    }
  }
  return undefined;
}
