/**
 * Wrapped, reconnecting `xrpl.js` client. This is the *only* place that submits
 * transactions, so it is also the only place that stamps the configured
 * `SourceTag` — no settlement path can forget it (PRD source-tag guarantee).
 *
 * Channel helpers are stubbed here and implemented in US-004; `getTransaction`
 * and `submitPayment` power the US-002 pay-per-call loop.
 */
import { Client, Wallet, xrpToDrops } from 'xrpl';
import type { Amount, Payment, TxResponse } from 'xrpl';
import { Asset, RLUSD_CURRENCY_CODE } from '@app/shared';

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

  /** PayChan channel creation — implemented in US-004. */
  createChannel(): Promise<never> {
    return Promise.reject(new Error('PayChan channels are implemented in US-004'));
  }

  /** PayChan claim redemption — implemented in US-004. */
  redeemChannel(): Promise<never> {
    return Promise.reject(new Error('PayChan channels are implemented in US-004'));
  }
}
