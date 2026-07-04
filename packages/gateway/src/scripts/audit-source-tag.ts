/**
 * Source-tag audit (US-008): scan the gateway wallet's recent on-chain
 * transactions and assert every one carries the configured `SOURCE_TAG`. Prints
 * any misses and exits non-zero when the audit fails, so it can gate a release.
 *
 * Run: `pnpm --filter @app/gateway audit:source-tag` (needs a funded gateway
 * wallet with settlement history on the configured `XRPL_NETWORK`).
 */
import { loadEnv } from '@app/shared';
import { XrplService } from '../services/xrpl.service.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const xrpl = new XrplService(
    env.xrplEndpoint,
    env.gatewayXrplSeed,
    env.sourceTag,
    env.rlusdIssuer,
  );

  try {
    const txns = await xrpl.getGatewaySubmittedTransactions();
    console.log(
      `Auditing ${txns.length} gateway-submitted transaction(s) for source tag ${env.sourceTag}…`,
    );

    const misses = txns.filter((tx) => tx.sourceTag !== env.sourceTag);
    for (const tx of misses) {
      console.error(`  MISS  ${tx.type.padEnd(20)} ${tx.hash}  sourceTag=${tx.sourceTag ?? '(none)'}`);
    }

    if (misses.length > 0) {
      console.error(
        `\nFAIL: ${misses.length}/${txns.length} transaction(s) are missing source tag ${env.sourceTag}.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(`\nPASS: all ${txns.length} gateway transaction(s) carry source tag ${env.sourceTag}.`);
  } finally {
    await xrpl.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('source-tag audit failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
