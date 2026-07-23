/**
 * Source-tag audit (US-008): scan each enabled network's gateway wallet for its
 * recent on-chain transactions and assert every one carries the configured
 * `SOURCE_TAG`. Prints any misses and exits non-zero when the audit fails, so it
 * can gate a release.
 *
 * Run: `pnpm --filter @app/gateway audit:source-tag` (needs a funded gateway
 * wallet with settlement history on each served network).
 */
import { loadEnv, networkConfig } from '@app/shared';
import { XrplService } from '../services/xrpl.service.js';

async function main(): Promise<void> {
  const env = loadEnv();
  let failed = false;
  let audited = 0;

  for (const network of env.enabledNetworks) {
    const config = networkConfig(env, network);
    const xrpl = new XrplService(
      config.endpoint,
      config.gatewayXrplSeed,
      env.sourceTag,
      config.rlusdIssuer,
    );

    try {
      const txns = await xrpl.getGatewaySubmittedTransactions();
      audited += txns.length;
      console.log(
        `\n[${network}] auditing ${txns.length} gateway-submitted transaction(s) ` +
          `for source tag ${env.sourceTag}…`,
      );

      const misses = txns.filter((tx) => tx.sourceTag !== env.sourceTag);
      for (const tx of misses) {
        console.error(
          `  MISS  ${tx.type.padEnd(20)} ${tx.hash}  sourceTag=${tx.sourceTag ?? '(none)'}`,
        );
      }

      if (misses.length > 0) {
        failed = true;
        console.error(
          `[${network}] FAIL: ${misses.length}/${txns.length} transaction(s) ` +
            `are missing source tag ${env.sourceTag}.`,
        );
      } else {
        console.log(
          `[${network}] PASS: all ${txns.length} gateway transaction(s) ` +
            `carry source tag ${env.sourceTag}.`,
        );
      }
    } catch (err) {
      // One unreachable network must not mask a real miss on another, so record
      // the failure and keep auditing the rest.
      failed = true;
      console.error(`[${network}] audit failed:`, err instanceof Error ? err.message : err);
    } finally {
      await xrpl.disconnect();
    }
  }

  console.log(
    `\n${failed ? 'FAIL' : 'PASS'}: audited ${audited} transaction(s) across ` +
      `${env.enabledNetworks.join(', ')}.`,
  );
  if (failed) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('source-tag audit failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
