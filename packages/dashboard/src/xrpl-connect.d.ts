/**
 * Ambient types for `xrpl-connect` — the published meta package ships as a
 * pre-bundled ESM file with no `.d.ts`. This declares the subset of its API the
 * dashboard uses, mirroring @xrpl-connect/core's source types.
 */
declare module 'xrpl-connect' {
  export interface NetworkInfo {
    id: string;
    [key: string]: unknown;
  }

  export interface AccountInfo {
    /** XRPL classic address (r...). */
    address: string;
    publicKey?: string;
    network: NetworkInfo;
  }

  export interface SignedTransaction {
    hash: string;
    tx_blob?: string;
    signature?: string;
    [key: string]: unknown;
  }

  export interface SignedMessage {
    message: string;
    signature: string;
    publicKey: string;
  }

  /** XRPL transaction object (loose — adapters autofill missing fields). */
  export type Transaction = Record<string, unknown>;

  export interface WalletAdapter {
    readonly id: string;
    readonly name: string;
    readonly icon?: string;
    readonly url?: string;
    isAvailable(): Promise<boolean>;
  }

  export interface WalletManagerOptions {
    adapters: WalletAdapter[];
    network: 'mainnet' | 'testnet' | string;
    autoConnect?: boolean;
  }

  export class WalletManager {
    constructor(options: WalletManagerOptions);
    readonly account: AccountInfo | null;
    readonly connected: boolean;
    connect(walletId: string): Promise<AccountInfo>;
    disconnect(): Promise<void>;
    reconnect(): Promise<AccountInfo | null>;
    sign(transaction: Transaction): Promise<SignedTransaction>;
    signMessage(message: string | Uint8Array): Promise<SignedMessage>;
    getAvailableWallets(): Promise<WalletAdapter[]>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    off(event: string, listener: (...args: unknown[]) => void): void;
  }

  export class GemWalletAdapter implements WalletAdapter {
    constructor();
    readonly id: string;
    readonly name: string;
    isAvailable(): Promise<boolean>;
  }
  export class CrossmarkAdapter implements WalletAdapter {
    constructor();
    readonly id: string;
    readonly name: string;
    isAvailable(): Promise<boolean>;
  }
  export class XamanAdapter implements WalletAdapter {
    constructor(options: { apiKey: string });
    readonly id: string;
    readonly name: string;
    isAvailable(): Promise<boolean>;
  }
  export class WalletConnectAdapter implements WalletAdapter {
    constructor(options: { projectId: string });
    readonly id: string;
    readonly name: string;
    isAvailable(): Promise<boolean>;
  }
  export class LedgerAdapter implements WalletAdapter {
    constructor();
    readonly id: string;
    readonly name: string;
    isAvailable(): Promise<boolean>;
  }
}
