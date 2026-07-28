/**
 * Build config for the published artifact. See the sibling config in
 * `sdk-server` for why `@app/shared` is bundled in rather than imported: the
 * published package must stand alone, without the unpublished workspace
 * package. `xrpl` and `ripple-keypairs` are real dependencies and stay
 * external.
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // See the sibling config: `resolve` inlines shared's types into the .d.ts so
  // TypeScript consumers do not need the unpublished workspace package.
  dts: { resolve: ['@app/shared/sdk'] },
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'node20',
  noExternal: ['@app/shared/sdk'],
  external: ['zod', 'xrpl', 'ripple-keypairs'],
});
