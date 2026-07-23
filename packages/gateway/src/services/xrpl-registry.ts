/**
 * One {@link XrplService} per enabled network, built once at startup.
 *
 * The gateway serves several XRPL networks at once, but every individual
 * operation belongs to exactly one — resolved from the challenge or channel it
 * acts on, never from process config. This registry is the only place that
 * mapping happens; downstream services receive an already-resolved
 * `XrplService` (see `forNetwork` in `../deps.ts`) so they cannot accidentally
 * transact on the wrong ledger.
 */
import { networkConfig, XrplNetwork } from '@app/shared';
import type { AppEnv } from '@app/shared';
import { XrplService } from './xrpl.service.js';

export class XrplRegistry {
  private readonly services: Map<XrplNetwork, XrplService>;

  constructor(env: AppEnv) {
    this.services = new Map(
      env.enabledNetworks.map((network) => {
        const config = networkConfig(env, network);
        return [
          network,
          new XrplService(
            config.endpoint,
            config.gatewayXrplSeed,
            env.sourceTag,
            config.rlusdIssuer,
          ),
        ];
      }),
    );
  }

  /** Networks this gateway serves, in configured order. */
  networks(): XrplNetwork[] {
    return [...this.services.keys()];
  }

  /** Whether `network` is served. */
  has(network: XrplNetwork): boolean {
    return this.services.has(network);
  }

  /**
   * The service for `network`.
   * @throws Error when the network is not enabled. Request paths must reject
   * unknown networks before reaching here, so this is a last-resort guard
   * against a disabled network leaking in from persisted data.
   */
  for(network: XrplNetwork): XrplService {
    const service = this.services.get(network);
    if (!service) {
      throw new Error(
        `no XRPL service for network ${network} (enabled: ${this.networks().join(',') || 'none'})`,
      );
    }
    return service;
  }

  /** Close every connection; used on graceful shutdown. */
  async disconnectAll(): Promise<void> {
    await Promise.all([...this.services.values()].map((service) => service.disconnect()));
  }
}
