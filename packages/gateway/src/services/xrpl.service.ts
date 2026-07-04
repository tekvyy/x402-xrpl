/**
 * Wrapped, reconnecting `xrpl.js` client. This is the *only* place that submits
 * transactions, so it is also the only place that stamps the configured
 * `SourceTag` — no settlement path can forget it (PRD source-tag guarantee).
 *
 * Channel helpers are stubbed here and implemented in US-004; `getTransaction`
 * and `submitPayment` power the US-002 pay-per-call loop.
 */
import { Client, Wallet, xrpToDrops } from 'xrpl';
import type { Amount, Payment, PaymentChannelClaim, TxResponse } from 'xrpl';
import { Asset, RLUSD_CURRENCY_CODE } from '@app/shared';

/** The PayChannel ledger-entry fields we read (xrpl.js does not export the type). */
export interface PayChannelEntry {
  LedgerEntryType: 'PayChannel';
  Account: string;
  Destination: string;
  /** Total deposit, in drops. */
  Amount: string;
  /** Amount already claimed, in drops. */
  Balance: string;
  /** Channel signing public key (hex). */
  PublicKey: string;
  SettleDelay: number;
}

/**
 * Convert an ASCII currency code to XRPL's on-ledger representation. Codes of
 * three characters are used verbatim; longer codes (like `RLUSD`) become a
 * 160-bit hex string right-padded with zeros.
 */
export function currencyToHex(code: string): string {
  if (code.length <= 3) return code;
  return Buffer.from(code, 'ascii').toString('hex').toUpperCase().padEnd(40, '0');
}

export interface SubmitPaymentParams {
  destination: string;
  asset: Asset;
  /** Amount in the asset's human unit (XRP or RLUSD), not drops. */
  amount: string;
  /** Optional UTF-8 memo strings (e.g. a challenge nonce). */
  memos?: string[];
}

export class XrplService {
  private readonly client: Client;
  private wallet: Wallet | undefined;
  private connecting: Promise<void> | undefined;

  constructor(
    private readonly endpoint: string,
    private readonly seed: string,
    private readonly sourceTag: number,
    private readonly rlusdIssuer: string,
  ) {
    this.client = new Client(endpoint);
  }

  /** The on-ledger currency code used for RLUSD issued amounts. */
  static rlusdCurrency(): string {
    return currencyToHex(RLUSD_CURRENCY_CODE);
  }

  /** Connect if needed; concurrent callers share a single in-flight connect. */
  async connect(): Promise<void> {
    if (this.client.isConnected()) return;
    if (!this.connecting) {
      this.connecting = this.client.connect().finally(() => {
        this.connecting = undefined;
      });
    }
    await this.connecting;
  }

  async disconnect(): Promise<void> {
    if (this.client.isConnected()) await this.client.disconnect();
  }

  /** Lazily derive the gateway's own wallet from its configured seed. */
  private getWallet(): Wallet {
    if (!this.wallet) this.wallet = Wallet.fromSeed(this.seed);
    return this.wallet;
  }

  /** The gateway wallet's classic address (e.g. the escrow deposit target). */
  address(): string {
    return this.getWallet().classicAddress;
  }

  /** Fetch a (hopefully validated) transaction by hash. */
  async getTransaction(txHash: string): Promise<TxResponse> {
    await this.connect();
    return this.client.request({ command: 'tx', transaction: txHash });
  }

  /** Build the XRPL `Amount` for a price expressed in the asset's human unit. */
  buildAmount(asset: Asset, humanAmount: string): Amount {
    if (asset === Asset.XRP) return xrpToDrops(humanAmount);
    return { currency: XrplService.rlusdCurrency(), issuer: this.rlusdIssuer, value: humanAmount };
  }

  /**
   * Submit a source-tagged Payment from the gateway wallet and wait for
   * validation. Returns the settled transaction hash.
   */
  async submitPayment(params: SubmitPaymentParams): Promise<string> {
    await this.connect();
    const wallet = this.getWallet();
    const tx: Payment = {
      TransactionType: 'Payment',
      Account: wallet.classicAddress,
      Destination: params.destination,
      Amount: this.buildAmount(params.asset, params.amount),
      SourceTag: this.sourceTag,
    };
    if (params.memos?.length) {
      tx.Memos = params.memos.map((memo) => ({
        Memo: { MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase() },
      }));
    }
    const prepared = await this.client.autofill(tx);
    const signed = wallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);
    return result.result.hash;
  }

  /**
   * Read a payment channel's on-ledger state. Used when a channel is registered
   * (POST /channels) to trust the ledger — not the client — for the channel's
   * destination, deposit, and signing public key.
   */
  async getPaymentChannel(channelId: string): Promise<PayChannelEntry | null> {
    await this.connect();
    try {
      const response = await this.client.request({
        command: 'ledger_entry',
        payment_channel: channelId,
        ledger_index: 'validated',
      });
      const node = response.result.node as PayChannelEntry | undefined;
      if (!node || node.LedgerEntryType !== 'PayChannel') return null;
      return node;
    } catch {
      return null;
    }
  }

  /**
   * Redeem accumulated off-ledger claims by submitting a source-tagged
   * `PaymentChannelClaim`. The signed claim authorizes payment to the channel's
   * destination, so the gateway can submit it on the seller's behalf. Returns
   * the settled tx hash.
   */
  async redeemChannel(params: RedeemChannelParams): Promise<string> {
    await this.connect();
    const wallet = this.getWallet();
    const tx: PaymentChannelClaim = {
      TransactionType: 'PaymentChannelClaim',
      Account: wallet.classicAddress,
      Channel: params.channelId,
      Balance: params.balanceDrops,
      Amount: params.balanceDrops,
      Signature: params.signature,
      PublicKey: params.publicKey,
      SourceTag: this.sourceTag,
    };
    const prepared = await this.client.autofill(tx);
    const signed = wallet.sign(prepared);
    const result = await this.client.submitAndWait(signed.tx_blob);
    return result.result.hash;
  }
}

export interface RedeemChannelParams {
  channelId: string;
  /** Cumulative balance to claim, in drops (the amount the claim authorizes). */
  balanceDrops: string;
  /** Claim signature produced by the channel's signing key. */
  signature: string;
  /** Channel signing public key (hex). */
  publicKey: string;
}
