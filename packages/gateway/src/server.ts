/**
 * Gateway process entrypoint: the single composition root. Loads validated
 * config, opens Postgres/Redis/XRPL connections, builds the app, and wires
 * graceful shutdown.
 */
import { loadEnv } from '@app/shared';
import { createPool } from './db/pool.js';
import { createRedis } from './redis/client.js';
import { XrplService } from './services/xrpl.service.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();

  const pool = createPool(env.databaseUrl);
  const redis = createRedis(env.redisUrl);
  await redis.connect();

  const xrpl = new XrplService(
    env.xrplEndpoint,
    env.gatewayXrplSeed,
    env.sourceTag,
    env.rlusdIssuer,
  );

  const publicBaseUrl =
    process.env.GATEWAY_PUBLIC_URL?.replace(/\/+$/, '') ?? `http://localhost:${env.gatewayPort}`;

  const app = await buildApp({ pool, redis, xrpl, env, publicBaseUrl });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await xrpl.disconnect();
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
