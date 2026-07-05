/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Gateway facilitator base URL. Defaults to http://localhost:8402. */
  readonly VITE_GATEWAY_URL?: string;
  /** XRPL network for explorer links: MAINNET | TESTNET. Defaults to TESTNET. */
  readonly VITE_XRPL_NETWORK?: string;
  /** Xaman (Xumm) API key; enables the Xaman wallet adapter when set. */
  readonly VITE_XAMAN_API_KEY?: string;
  /** WalletConnect project id; enables the WalletConnect adapter when set. */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
