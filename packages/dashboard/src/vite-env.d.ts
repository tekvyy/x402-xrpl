/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Gateway facilitator base URL. Defaults to http://localhost:8402. */
  readonly VITE_GATEWAY_URL?: string;
  /** XRPL network for explorer links: MAINNET | TESTNET. Defaults to TESTNET. */
  readonly VITE_XRPL_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
