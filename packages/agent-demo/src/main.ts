/**
 * CLI entry point: `node dist/main.js` (or `pnpm --filter @app/agent-demo start`).
 * Loads config from the environment, connects, runs the full demo, and exits.
 */
import { loadAgentConfig } from './config.js';
import { connectAgent, runAgentDemo } from './agent.js';

async function main(): Promise<void> {
  const config = loadAgentConfig();
  const { client, wallet } = await connectAgent(config);
  try {
    await runAgentDemo(config, client, wallet);
  } finally {
    await client.disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('agent demo failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
