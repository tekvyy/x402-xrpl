/**
 * Build config for the published artifact. `@app/shared` is an internal
 * workspace package that is never published, so it is bundled IN rather than
 * left as an import: a consumer running `npm i @xrpl-x402/server` must not need
 * to resolve `@app/shared` (a `workspace:*` dependency fails outside this repo
 * with EUNSUPPORTEDPROTOCOL). Real runtime deps and peer frameworks stay
 * external so consumers dedupe them normally.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // `resolve` makes the .d.ts bundler inline shared's types too; without it the
  // declarations keep a bare `import ... from '@app/shared/sdk'` that no
  // consumer can resolve, so JS works and TypeScript breaks.
  dts: { resolve: ['@app/shared/sdk'] },
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'node20',
  noExternal: ['@app/shared/sdk'],
  external: ['zod', 'express', 'fastify'],
});
