# AGENTS.md — Reusable conventions for the XRPL x402 Gateway monorepo

- Monorepo: pnpm workspaces, `packages/*`, each package `@app/<name>` with `"type": "module"`.
- TypeScript: every package `tsconfig.json` extends root `tsconfig.base.json` (NodeNext, strict, `verbatimModuleSyntax`). Relative imports MUST use `.js` extensions.
- Shared contracts live ONLY in `packages/shared` (enums, constants, env, zod x402 schemas). Never redefine enums or use bare string literals for domain concepts — import from `@app/shared`.
- Enums are the source of truth. Postgres enum types in `migrations/` mirror `packages/shared/src/enums.ts` — keep them in lockstep.
- Config: use `loadEnv()` from `@app/shared`; it throws an aggregated error on missing keys. Add new keys to both `env.ts` and `.env.example`.
- Migrations: `migrations/<numeric>_name.sql`, node-pg-migrate SQL format with `-- Up Migration` / `-- Down Migration`. Run `pnpm migrate:up` / `pnpm migrate:down`.
- Every gateway-submitted XRPL tx must carry the configured `SOURCE_TAG` (inject centrally in the XRPL service).
- Verify commands: `pnpm -r build`, `pnpm -r typecheck`. No local Postgres/Docker in this env — validate migration SQL with `@electric-sql/pglite` (install as throwaway, remove after).
