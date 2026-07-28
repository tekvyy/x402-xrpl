/**
 * SDK-facing surface of the shared package: everything except `env.ts`.
 *
 * The published SDKs (`@xrpl-x402/client`, `@xrpl-x402/server`) bundle this
 * module in, because `@app/shared` is never published and a `workspace:*`
 * dependency cannot resolve outside this repo. `env.ts` is deliberately absent:
 * it is the *gateway's* config schema, so bundling it would ship the operator's
 * env shape (DATABASE_URL, AUTH_SECRET, …) inside every consumer's node_modules
 * as dead code. Relying on tree-shaking to drop it does not work, since its
 * top-level `z.object(...)` is not provably side-effect free.
 *
 * Keep this entry free of gateway-only code.
 */
export * from './enums.js';
export * from './constants.js';
export * from './x402.js';
export * from './auth.js';
