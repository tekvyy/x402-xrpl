/**
 * Dashboard sign-in helper. Signs the gateway's sign-in-with-XRPL challenge with
 * your wallet seed (locally — the seed never leaves this machine) and prints a
 * session token to paste into the dashboard's "Paste session token" field.
 *
 *   pnpm login <SEED>
 *   GATEWAY_URL=https://gw.example pnpm login <SEED>
 *
 * The seed can also come from AGENT_SEED / GATEWAY_XRPL_SEED in .env.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signInWithGateway } from '../packages/sdk-client/dist/index.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

async function main() {
  const fileEnv = parseEnvFile(resolve(rootDir, '.env'));
  const seed = process.argv[2] ?? process.env.AGENT_SEED ?? fileEnv.AGENT_SEED ?? fileEnv.GATEWAY_XRPL_SEED;
  if (!seed) {
    throw new Error('usage: pnpm login <SEED>  (or set AGENT_SEED in .env)');
  }
  const gatewayUrl = process.env.GATEWAY_URL ?? fileEnv.GATEWAY_PUBLIC_URL ?? 'http://localhost:8402';

  const session = await signInWithGateway({ gatewayUrl, seed });
  console.log(`\nSigned in as ${session.address}`);
  console.log(`Session expires: ${new Date(session.expiresAt).toISOString()}`);
  console.log('\nPaste this token into the dashboard (Paste session token):\n');
  console.log(session.token);
  console.log('');
}

main().catch((err) => {
  console.error('login failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
