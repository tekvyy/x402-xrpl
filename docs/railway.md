# Deploying the portal + backend to Railway

Only two of the five workspace packages are deployed:

| Railway service | Package              | What it is                       | Config file              |
| --------------- | -------------------- | -------------------------------- | ------------------------ |
| `gateway`       | `packages/gateway`   | Fastify API (the portal backend) | `railway.gateway.json`   |
| `dashboard`     | `packages/dashboard` | Static Vite SPA (the portal)     | `railway.dashboard.json` |

`packages/shared` is not a service; it is a library both builds pull in
automatically via pnpm's `...` filter. `sdk-client` and `sdk-server` are
consumed by callers and sellers, never built or deployed here.

Both services also need Railway's **Postgres** and **Redis** plugins.

## One-time setup

Create one Railway project with four services: `Postgres`, `Redis`, `gateway`,
`dashboard`. For each of the two code services:

1. Point it at this repo. Leave **Root Directory** as the repo root — pnpm
   workspaces need the root lockfile, so do not set it to the package dir.
2. Set **Settings → Config-as-code → Railway Config File** to the matching path:
   - `gateway` → `railway.gateway.json`
   - `dashboard` → `railway.dashboard.json`
3. Generate a public domain for each.

The config files pin the build to a single package, so each service builds only
its own code. `watchPatterns` means a dashboard-only commit will not redeploy the
gateway, and vice versa.

Note: the install step still resolves the whole workspace's dependencies (that is
how pnpm lockfiles work); only the _build_ and _deploy_ are scoped.

## Environment variables

### `gateway`

Set these in the Railway service. `${{...}}` values are Railway reference
variables, typed literally into the UI.

| Variable                    | Value                                | Notes                                                                           |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| `GATEWAY_PORT`              | `${{PORT}}`                          | Required: the app reads `GATEWAY_PORT`, Railway supplies `PORT`.                |
| `DATABASE_URL`              | `${{Postgres.DATABASE_URL}}`         |                                                                                 |
| `REDIS_URL`                 | `${{Redis.REDIS_URL}}`               |                                                                                 |
| `DASHBOARD_ORIGIN`          | `https://<dashboard-domain>`         | CORS. Must exactly match the portal's URL, no trailing slash.                   |
| `GATEWAY_PUBLIC_URL`        | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | Used to build absolute URLs.                                                    |
| `TRUST_PROXY`               | `1`                                  | Trusted proxy hops. Railway fronts the app with exactly one; at `0` every per-IP rate limit keys on the proxy, and higher values trust forged `X-Forwarded-For` entries. |
| `AUTH_SECRET`               | (32+ random chars)                   | Session signing secret.                                                         |
| `GATEWAY_XRPL_SEED`         | (family seed)                        | Covers both networks (same address on each). Treat as a secret.                 |
| `GATEWAY_XRPL_SEED_MAINNET` | (family seed)                        | Optional: only to use a _different_ wallet on mainnet. Real funds.              |
| `SOURCE_TAG`                | `2606150004`                         | Shared across networks.                                                         |

Optional: `XRPL_ENDPOINT_<NETWORK>`, `RLUSD_ISSUER_<NETWORK>` (Ripple's issuers
are built in), `ESCROW_ENABLED`, `PLATFORM_FEE_BPS`. See
`.env.example` for the full list; `loadEnv` fails fast at boot listing anything
missing.

### `dashboard`

`VITE_*` vars are inlined by Vite at **build** time, not read at runtime. They
must be set before the build, and changing one requires a redeploy to take
effect.

| Variable           | Value                      | Notes              |
| ------------------ | -------------------------- | ------------------ |
| `VITE_GATEWAY_URL` | `https://<gateway-domain>` | No trailing slash. |

The XRPL network is chosen in the dashboard UI (a toggle that reads the
gateway's served networks), so there is no network env var.

Optional: `VITE_XAMAN_API_KEY`, `VITE_WALLETCONNECT_PROJECT_ID`. GemWallet and
Crossmark need no config.

## How each service runs

**gateway** — builds `pnpm --filter @app/gateway... build` (gateway + shared
only), then starts with `pnpm migrate:up && pnpm --filter @app/gateway start`, so
SQL migrations in `migrations/` apply on every deploy before the server accepts
traffic. Health checks hit `/health`.

**dashboard** — builds the SPA, then serves `dist/` with `vite preview` on
`$PORT`. Vite rejects unrecognised `Host` headers as DNS-rebinding protection,
which would 403 Railway's own domain, so `vite.config.ts` allows
`RAILWAY_PUBLIC_DOMAIN`. **If you attach a custom domain, add it to
`PREVIEW_ALLOWED_HOSTS`** (comma-separated) on the dashboard service or it will
be blocked.

## Deploy order

Bring up `Postgres` and `Redis` first, then `gateway`, then `dashboard`. The two
public URLs reference each other (`DASHBOARD_ORIGIN` ↔ `VITE_GATEWAY_URL`), so
after both domains exist, set those two vars and redeploy both once.
