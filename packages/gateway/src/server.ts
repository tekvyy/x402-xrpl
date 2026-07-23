/**
 * Gateway process entrypoint: the single composition root. Loads validated
 * config, opens Postgres/Redis/XRPL connections, builds the app, and wires
 * graceful shutdown.
 */
import { loadEnv, networkConfig } from '@app/shared';
import { createPool } from './db/pool.js';
import { createRedis } from './redis/client.js';
import { XrplRegistry } from './services/xrpl-registry.js';
import { startMaintenance } from './services/maintenance.service.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();

  const pool = createPool(env.databaseUrl);
  const redis = createRedis(env.redisUrl);
  await redis.connect();

  const xrplRegistry = new XrplRegistry(env);

  // Log the wallet per network at boot: an operator's fastest check that the
  // right (and funded) account is configured for each ledger being served.
  for (const network of env.enabledNetworks) {
    console.log(
      `[xrpl] ${network} → ${networkConfig(env, network).endpoint} ` +
        `as ${xrplRegistry.for(network).address()}`,
    );
  }

  const publicBaseUrl =
    process.env.GATEWAY_PUBLIC_URL?.replace(/\/+$/, '') ?? `http://localhost:${env.gatewayPort}`;

  const app = await buildApp({ pool, redis, xrplRegistry, env, publicBaseUrl });

  const stopMaintenance = startMaintenance({ pool, xrplRegistry, env });

  const shutdown = async (): Promise<void> => {
    stopMaintenance();
    await app.close();
    await xrplRegistry.disconnectAll();
    redis.disconnect();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: env.gatewayPort, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
