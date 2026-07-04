/**
 * Gateway service entrypoint (facilitator + proxy). Implemented in US-002+.
 * For now this only proves the shared contract resolves and the config loads.
 */
import { loadEnv, XrplNetwork } from '@app/shared';

export function describeGateway(): string {
  const network: XrplNetwork = XrplNetwork.TESTNET;
  return `XRPL x402 gateway (default network: ${network})`;
}

export { loadEnv };
