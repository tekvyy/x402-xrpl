# AGENTS.md — Reusable conventions for the XRPL x402 Gateway monorepo

- Monorepo: pnpm workspaces, `packages/*`, each package `@app/<name>` with `"type": "module"`.
- TypeScript: every package `tsconfig.json` extends root `tsconfig.base.json` (NodeNext, strict, `verbatimModuleSyntax`). Relative imports MUST use `.js` extensions.
- Shared contracts live ONLY in `packages/shared` (enums, constants, env, zod x402 schemas). Never redefine enums or use bare string literals for domain concepts — import from `@app/shared`.
- Enums are the source of truth. Postgres enum types in `migrations/` mirror `packages/shared/src/enums.ts` — keep them in lockstep.
- Config: use `loadEnv()` from `@app/shared`; it throws an aggregated error on missing keys. Add new keys to both `env.ts` and `.env.example`.
- Migrations: `migrations/<numeric>_name.sql`, node-pg-migrate SQL format with `-- Up Migration` / `-- Down Migration`. Run `pnpm migrate:up` / `pnpm migrate:down`.
- Every gateway-submitted XRPL tx must carry the configured `SOURCE_TAG` (inject centrally in the XRPL service).
- Verify commands: `pnpm -r build`, `pnpm -r typecheck`. No local Postgres/Docker in this env — validate migration SQL with `@electric-sql/pglite` (install as throwaway, remove after).
- Runtime verification without live infra: build, then run a throwaway `.mjs` against `packages/*/dist` with in-memory stubs (a `pool` whose `query`/`connect` match on SQL prefixes, stub `redis`, and a fake XRPL via `Object.create(XrplService.prototype)` overriding `getTransaction`). Use `fastify.inject()` for routes and `.listen()` for a real origin. Delete the script after.
- Gateway architecture: routes (`routes/*.route.ts`) are thin; logic lives in `services/*` and data access in `db/repositories.ts` (every repo fn takes an explicit `Queryable` so it works inside a pooled-client transaction). Deps are injected via `GatewayDeps` (no module singletons); `server.ts` is the sole composition root.
- Pay-per-call verification is one shared fn `verifyPayPerCall` (side-effect-free); `settle`/`verify` in `settle.service.ts` reuse it. Single-use nonce is enforced by an atomic `UPDATE challenges SET status WHERE status = ANY(allowed)` guard, not an app-level check.
- On-ledger amounts: store/compare human units in DB; the x402 wire `amount` is drops for XRP (via `xrpToDrops`) and human units for RLUSD. Compare decimals with `util/decimal.ts` (scaled BigInt), never `Number`. RLUSD on-ledger currency is the 40-hex form (`XrplService.rlusdCurrency()`), not the 3-char code.
