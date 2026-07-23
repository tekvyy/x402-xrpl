/**
 * One-command demo (US-008). Boots demo-origin + gateway + dashboard, seeds a
 * demo seller and freshly funded testnet wallets, then runs the agent demo end
 * to end: open a channel → ~20 off-ledger metered calls → one pay-per-call that
 * settles on chain (explorer URL printed). Servers stay up afterwards so the
 * live dashboard can be watched; Ctrl-C tears everything down.
 *
 *   pnpm demo
 *
 * Prerequisites: Postgres + Redis reachable via DATABASE_URL / REDIS_URL (from
 * .env). The demo itself transacts on TESTNET so wallets can be faucet-funded;
 * the gateway serves mainnet too, but its faucet wallet is unfunded there, so
 * nothing can settle on mainnet. Sellers choose which networks to advertise on.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(rootDir, 'packages/gateway/package.json'));
const { Client, Wallet } = require('xrpl');

const GATEWAY_PORT = 8402;
const DEMO_ORIGIN_PORT = 8403;
const DASHBOARD_PORT = 5173;
const TESTNET_ENDPOINT = 'wss://s.altnet.rippletest.net:51233';
const PRICE_XRP = '0.01';
const DEPOSIT_XRP = '1';
const METERED_CALLS = '20';

const children = [];

/** Parse a minimal KEY=VALUE .env file into an object (ignores comments/blanks). */
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Spawn a long-lived child process, streaming its output with a label prefix. */
function start(label, command, args, env) {
  const child = spawn(command, args, { cwd: rootDir, env: { ...process.env, ...env } });
  children.push(child);
  const prefix = (line) => `[${label}] ${line}`;
  child.stdout.on('data', (d) =>
    process.stdout.write(
      String(d)
        .replace(/^/gm, () => '')
        .split('\n')
        .filter(Boolean)
        .map(prefix)
        .join('\n') + '\n',
    ),
  );
  child.stderr.on('data', (d) =>
    process.stderr.write(String(d).split('\n').filter(Boolean).map(prefix).join('\n') + '\n'),
  );
  return child;
}

/** Run a command to completion, rejecting on a non-zero exit. */
function run(label, command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = start(label, command, args, env);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`${label} exited with code ${code}`)),
    );
  });
}

/** Poll a URL until it responds (any status), or throw after the timeout. */
async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Faucet-fund a fresh testnet wallet and return it. */
async function fundWallet(client, role) {
  const { wallet } = await client.fundWallet();
  console.log(`  funded ${role.padEnd(8)} ${wallet.classicAddress} (seed hidden)`);
  return wallet;
}

function shutdown(code = 0) {
  for (const child of children) child.kill('SIGINT');
  process.exit(code);
}

async function main() {
  const fileEnv = parseEnvFile(resolve(rootDir, '.env'));
  const databaseUrl = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL ?? fileEnv.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    throw new Error('DATABASE_URL and REDIS_URL must be set (copy .env.example to .env).');
  }

  const sourceTag = process.env.SOURCE_TAG ?? fileEnv.SOURCE_TAG ?? '2606150004';
  const xrplEndpoint =
    process.env.XRPL_ENDPOINT_TESTNET ?? fileEnv.XRPL_ENDPOINT_TESTNET ?? TESTNET_ENDPOINT;
  const authSecret = process.env.AUTH_SECRET ?? fileEnv.AUTH_SECRET ?? 'demo-auth-secret-change-me';

  // The demo transacts on testnet only so wallets can be faucet-funded; the
  // gateway still serves both networks (mainnet stays idle, wallet unfunded).
  const baseEnv = {
    XRPL_ENDPOINT_TESTNET: xrplEndpoint,
    SOURCE_TAG: sourceTag,
    AUTH_SECRET: authSecret,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    DASHBOARD_ORIGIN: `http://localhost:${DASHBOARD_PORT}`,
  };

  console.log('==> Building all packages…');
  await run('build', 'pnpm', ['-r', 'build']);

  console.log('==> Applying migrations…');
  await run('migrate', 'pnpm', ['migrate:up'], baseEnv);

  console.log('==> Funding testnet wallets via faucet…');
  const client = new Client(xrplEndpoint);
  await client.connect();
  let gatewayWallet;
  let agentWallet;
  let sellerWallet;
  try {
    gatewayWallet = await fundWallet(client, 'gateway');
    agentWallet = await fundWallet(client, 'agent');
    sellerWallet = await fundWallet(client, 'seller');
  } finally {
    await client.disconnect();
  }

  console.log('==> Starting gateway and dashboard…');
  start('gateway', 'node', ['packages/gateway/dist/server.js'], {
    ...baseEnv,
    GATEWAY_XRPL_SEED_TESTNET: gatewayWallet.seed,
    GATEWAY_PORT: String(GATEWAY_PORT),
    GATEWAY_PUBLIC_URL: `http://localhost:${GATEWAY_PORT}`,
  });
  start(
    'dashboard',
    'pnpm',
    ['--filter', '@app/dashboard', 'dev', '--', '--port', String(DASHBOARD_PORT)],
    {
      ...baseEnv,
      VITE_GATEWAY_URL: `http://localhost:${GATEWAY_PORT}`,
      VITE_XRPL_NETWORK: 'TESTNET',
    },
  );

  await waitForHttp(
    `http://localhost:${GATEWAY_PORT}/sellers/00000000-0000-0000-0000-000000000000`,
  );

  console.log('==> Signing in the seller (sign-in-with-XRPL)…');
  const { signInWithGateway } = await import(
    pathToFileURL(resolve(rootDir, 'packages/sdk-client/dist/index.js')).href
  );
  const session = await signInWithGateway({
    gatewayUrl: `http://localhost:${GATEWAY_PORT}`,
    seed: sellerWallet.seed,
  });
  console.log(`  authenticated ${session.address}`);

  console.log('==> Registering demo seller…');
  const sellerRes = await fetch(`http://localhost:${GATEWAY_PORT}/sellers`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({
      name: 'Demo Weather API',
      originUrl: `http://localhost:${DEMO_ORIGIN_PORT}`,
      payToAddress: sellerWallet.classicAddress,
      priceAmount: PRICE_XRP,
      priceAsset: 'XRP',
      // The demo exercises both paths: 20 metered credit calls + 1 pay-per-call.
      paymentMode: 'BOTH',
      networks: ['TESTNET'],
    }),
  });
  if (!sellerRes.ok) throw new Error(`seller registration failed (${sellerRes.status})`);
  const { sellerId } = await sellerRes.json();
  console.log(`  seller ${sellerId} registered`);

  // The seller's own API prices its routes via the sdk-server middleware,
  // which delegates challenges and settlement to the gateway (facilitator).
  console.log('==> Starting the demo seller API (x402 middleware)…');
  start('origin', 'node', ['packages/demo-origin/dist/server.js'], {
    ...baseEnv,
    DEMO_ORIGIN_PORT: String(DEMO_ORIGIN_PORT),
    GATEWAY_URL: `http://localhost:${GATEWAY_PORT}`,
    SELLER_ID: sellerId,
  });
  await waitForHttp(`http://localhost:${DEMO_ORIGIN_PORT}/data`);

  console.log('\n==> Running the agent demo (channel → 20 metered calls → 1 pay-per-call)…\n');
  await run('agent', 'node', ['packages/agent-demo/dist/main.js'], {
    ...baseEnv,
    GATEWAY_URL: `http://localhost:${GATEWAY_PORT}`,
    SELLER_ID: sellerId,
    AGENT_SEED: agentWallet.seed,
    RESOURCE: 'data',
    CHANNEL_DEPOSIT_XRP: DEPOSIT_XRP,
    METERED_CALLS,
  });

  console.log('\n==> Demo complete. Dashboard is live (pre-authenticated as the demo seller):');
  console.log(
    `      http://localhost:${DASHBOARD_PORT}/#token=${encodeURIComponent(session.token)}`,
  );
  console.log('    Press Ctrl-C to stop the gateway, origin, and dashboard.');
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((err) => {
  console.error('\ndemo failed:', err instanceof Error ? err.message : err);
  shutdown(1);
});
