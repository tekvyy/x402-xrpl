/**
 * Verify the wallets in `.env.mainnet` are funded and ready for the mainnet run.
 * Reads addresses locally, queries mainnet, and reports the spendable balance
 * (balance minus the reserve XRPL locks up) per wallet.
 *
 *   node scripts/check-mainnet-wallets.mjs
 *
 * Seeds are never sent anywhere — only the public addresses are queried.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(rootDir, 'packages/gateway/package.json'));
const { Client, dropsToXrp } = require('xrpl');

const ENV_PATH = resolve(rootDir, '.env.mainnet');
const MAINNET_ENDPOINT = 'wss://xrplcluster.com';

/** Minimum spendable XRP each wallet needs for the run to succeed. */
const MIN_SPENDABLE_XRP = { GATEWAY: 1, AGENT: 3, SELLER: 0 };

if (!existsSync(ENV_PATH)) {
  console.error(`missing ${ENV_PATH} — run: node scripts/gen-mainnet-wallets.mjs`);
  process.exit(1);
}

const env = {};
for (const raw of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

const client = new Client(MAINNET_ENDPOINT);
await client.connect();

const { reserve_base_xrp: baseReserve, reserve_inc_xrp: ownerReserve } = (
  await client.request({ command: 'server_info' })
).result.info.validated_ledger;

let ready = true;

for (const key of ['GATEWAY', 'AGENT', 'SELLER']) {
  const address = env[`${key}_ADDRESS`];
  if (!address) {
    console.log(`${key.padEnd(8)} (no address in .env.mainnet)`);
    ready = false;
    continue;
  }
  try {
    const { account_data: account } = (
      await client.request({ command: 'account_info', account: address, ledger_index: 'validated' })
    ).result;
    const balance = Number(dropsToXrp(account.Balance));
    const reserved = baseReserve + ownerReserve * account.OwnerCount;
    const spendable = balance - reserved;
    const needed = MIN_SPENDABLE_XRP[key];
    const ok = spendable >= needed;
    if (!ok) ready = false;
    console.log(
      `${ok ? 'OK  ' : 'LOW '} ${key.padEnd(8)} ${address}  ` +
        `balance ${balance} XRP, reserved ${reserved} XRP, spendable ${spendable.toFixed(6)} XRP` +
        (ok ? '' : ` (needs >= ${needed} XRP spendable)`),
    );
  } catch (error) {
    const unfunded = String(error?.data?.error ?? error?.message).includes('actNotFound');
    console.log(
      `${'MISS'} ${key.padEnd(8)} ${address}  ` +
        (unfunded ? 'account not found on mainnet — not funded yet' : `lookup failed: ${error}`),
    );
    ready = false;
  }
}

await client.disconnect();

console.log(
  ready ? '\nAll wallets funded and ready.' : '\nNot ready yet — fund the wallets above.',
);
process.exit(ready ? 0 : 1);
