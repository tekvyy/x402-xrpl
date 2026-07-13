# XRPL x402 Monetization Gateway

A drop-in server middleware + facilitator gateway that lets any HTTP API charge **per call** in **XRP** or
**RLUSD** using the **x402 (HTTP 402 Payment Required)** protocol — plus a live
**seller dashboard**. It is a faithful XRPL port of Coinbase's x402 (originally
Base/USDC): the gateway acts as the **x402 facilitator** exposing `/verify` and
`/settle`, while clients pay with either a direct XRPL Payment (pay-per-call) or
off-ledger **Payment Channel (PayChan)** claims (prepaid credits — XRPL's native
analog to Base's EIP-3009 signed authorizations).

**Primary wedge:** autonomous **AI agents** that can't sign up for Stripe but can
hold an XRPL wallet and pay x402 per API call. Secondary: human sellers who want
to monetize an API in minutes with zero payment-processor onboarding.

Every settled XRPL transaction carries a configurable **source tag** so on-chain
activity counts toward the XRPL Commons leaderboard.

## How it maps to real x402 on Base

| Base x402 primitive | XRPL port |
| --- | --- |
| `402` response with `accepts[]` payment requirements | Same `402` + `accepts[]` challenge issued by the gateway |
| `X-PAYMENT` request header (base64 signed payload) | Same header; payload is an XRPL tx hash (pay-per-call) or a signed PayChan claim (credits) |
| EIP-3009 `transferWithAuthorization` off-chain auth | **PayChan signed claim** — off-ledger, monotonic, redeemed later |
| Coinbase Facilitator `/verify` + `/settle` | **The gateway is the facilitator**: `/verify` + `/settle` |
| `X-PAYMENT-RESPONSE` header (settlement tx hash) | Same header with XRPL tx hash + explorer link |

## Architecture

```
AI Agent / Client ──(x402fetch: handles 402, pays, retries)──► SELLER'S API
                                                               (@app/sdk-server middleware
                                                                on the seller's own routes)
                                                                       │
                                                    delegates /challenge /verify /settle
                                                                       ▼
                                  ┌──────────── GATEWAY (x402 facilitator) ───────────┐
                                  │  • 402 challenge issuer (price, payTo, nonce)      │
                                  │  • /verify  /settle  (XRP + RLUSD)                 │
                                  │  • verifier: onchain Payment  OR  PayChan claim    │
                                  │  • credit ledger per wallet (Postgres)             │
                                  │  • nonce cache + rate limit + pubsub (Redis)       │
                                  │  • usage logger  ──► dashboard (SSE)               │
                                  └──────────────────┬────────────────────────────────┘
                                                     ▼
                                            XRPL (xrpl.js):
                                            verify tx / redeem
                                            PayChan claim, source tag
```

The seller's API stays in the seller's hands — the middleware answers `402`
for unpaid requests and lets paid ones through, delegating every x402
decision to the gateway. Because payment is enforced *in* the seller's server,
there is no separate unmetered origin URL to leak or bypass.

### Two payment modes

- **Pay-per-call** — client submits a direct XRPL `Payment` for the exact price;
  the gateway verifies the tx on-ledger and forwards the request. Settles on
  chain, one tx per call.
- **Prepaid credits (PayChan)** — client opens one Payment Channel, then makes
  many **off-ledger** metered calls by sending monotonically increasing signed
  claims. Credits tick down with no per-call on-chain wait; the gateway redeems
  the channel on chain later. This is the fast path for AI agents.

Each seller picks a **payment setup** at registration: `PAY_PER_CALL`
(traditional), `PREPAID_CREDITS` (credits only), or `BOTH`. The 402 `accepts[]`
advertises one entry per allowed mode, and the gateway enforces the setup
end-to-end — settles in a disallowed mode are rejected, channels cannot be
opened against pay-per-call-only sellers, and bots must match the seller's
setup. Credits setups require XRP pricing (PayChan is XRP-native).

### Known limitations

PayChan is x402's *shape* on XRPL, not EIP-3009's *economics*. Two consequences
a caller should plan around:

- **Per-seller capital lockup.** Unlike an EIP-3009 authorization drawn from one
  fungible USDC balance, a PayChan channel is per (payer, destination) and must be
  funded on chain up front. An agent that calls many sellers opens (and locks
  capital in) a channel per seller; the first call to a new seller still costs an
  on-chain channel open or a pay-per-call.
- **RLUSD has no off-ledger fast path.** PayChan is XRP-native, so prepaid credits
  are XRP-only. Pricing in RLUSD works only via pay-per-call (one on-chain
  settlement, ~a ledger round-trip, per call). Stable-unit pricing and the
  off-ledger fast path are therefore mutually exclusive today.

The gateway safeguards the credits path: it rejects channels whose `SettleDelay`
or `CancelAfter` leave too little runway to redeem, stops honoring claims near
expiry, and auto-redeems on chain as a channel fills — so delivered value is
pulled before a channel can be closed and its deposit reclaimed.

## Monorepo layout

pnpm workspaces, TypeScript (NodeNext, strict). Each package is `@app/<name>`.

| Package | Role |
| --- | --- |
| `shared` | Types, enums, constants, x402 payload schemas (zod), `loadEnv()` |
| `gateway` | Node/Fastify gateway service — x402 facilitator + dashboard API |
| `sdk-client` | `x402fetch` + wallet/payment/channel helpers |
| `sdk-server` | Express/Fastify server middleware (delegates to the gateway) |
| `dashboard` | Vite + React seller dashboard |
| `agent-demo` | AI agent demo — pays per call via an MCP-style tool |
| `demo-origin` | Demo seller API — its `/data` route is metered by the `sdk-server` middleware |

## Quick start

Prerequisites: **Node ≥ 20**, **pnpm**, and reachable **Postgres** + **Redis**.

```bash
pnpm install
cp .env.example .env      # then edit values (see below)
pnpm demo
```

`pnpm demo` runs the full end-to-end path on **testnet**:

1. Builds every package and applies migrations.
2. Faucet-funds three fresh testnet wallets — gateway, agent, seller.
3. Boots the `gateway` (`:8402`) and the `dashboard` (`:5173`).
4. Registers a demo seller (price = `0.01 XRP`, setup = `BOTH`), then boots
   `demo-origin` (`:8403`) with the x402 middleware charging as that seller.
5. Runs the agent: open one PayChan → **20 off-ledger metered calls** → **one
   pay-per-call** request that settles on chain, printing the explorer URL.

Servers stay up afterward so the live dashboard can be watched. `Ctrl-C` to tear
down. Full walkthrough in [`DEMO.md`](DEMO.md).

## Dashboard sign-in

The dashboard (`:5173`) requires a session. Auth is **sign-in-with-XRPL**: you
sign a gateway challenge with your wallet key — the seed never leaves your
machine.

```bash
pnpm login <YOUR_WALLET_SEED>   # prints a session token
```

Paste the token into the dashboard's "Sign in" screen. Two tabs:

- **My APIs** — register your APIs and watch live revenue, usage, and the
  settlement feed (scoped to your signed-in address).
- **My Bots** — configure self-custody paying agents (seller, spend caps,
  deposit) and download a ready-to-run `.env` + run command. The bot seed stays
  with you; the gateway stores only the config and the bot's public address.

## Facilitator endpoints

Thin HTTP wrappers over the core x402 services:

- `POST /challenge` — issue a single-use nonce for a registered seller.
- `POST /settle` — verify + consume a payment (returns `SETTLED` / `REJECTED`).
- `POST /verify` — verify without consuming.

Server middleware (`@app/sdk-server`) is pure delegation — it holds no XRPL or
verify logic. Config is just `{ gatewayUrl, sellerId }`; pricing lives in the
gateway seller registration (single source of truth).

## Configuration

Copy `.env.example` to `.env`. Key vars:

| Var | Purpose |
| --- | --- |
| `XRPL_NETWORK` | `MAINNET` \| `TESTNET` |
| `XRPL_ENDPOINT` | Override JSON-RPC/WebSocket endpoint (optional) |
| `GATEWAY_XRPL_SEED` | Gateway wallet seed (funds settlements, redeems channels) |
| `AUTH_SECRET` | Signs dashboard session tokens (≥ 16 chars) |
| `SOURCE_TAG` | Stamped on every gateway-submitted XRPL tx |
| `RLUSD_ISSUER` | RLUSD issuer classic address for the selected network |
| `DATABASE_URL` | Postgres — durable ledger/usage/sellers |
| `REDIS_URL` | Redis — nonce cache, rate limit, live-feed pub/sub |
| `GATEWAY_PORT` | Gateway HTTP port (default `8402`) |
| `DASHBOARD_ORIGIN` | Allowed dashboard origin (CORS) |
| `ESCROW_ENABLED` | Custodial escrow-credits fallback (default `false`; the authentic path is PayChan) |
| `PLATFORM_FEE_BPS` | Platform fee in basis points on the PayChan credits path (default `0` = off). When set, channels open to the gateway, which redeems on chain and forwards the seller's cut minus the fee. |

### Mainnet vs testnet

The demo forces `XRPL_NETWORK=TESTNET` so wallets can be faucet-funded. For
**mainnet**, start packages individually with a real funded `GATEWAY_XRPL_SEED`
and `XRPL_NETWORK=MAINNET`. Only `XRPL_NETWORK` / `XRPL_ENDPOINT` and the
`RLUSD_ISSUER` are network-dependent.

## Development

```bash
pnpm build          # build all packages
pnpm typecheck      # typecheck all packages
pnpm lint           # eslint
pnpm format         # prettier --write
pnpm migrate:up     # apply migrations
pnpm migrate:down   # roll back one migration
pnpm audit:source-tag   # verify every gateway-submitted tx carries SOURCE_TAG
```

Conventions and architecture notes live in [`AGENTS.md`](AGENTS.md); the full
spec is in [`PRD.md`](PRD.md).

### Source-tag audit

After settlements exist, verify the on-chain guarantee:

```bash
pnpm audit:source-tag
```

Scans the gateway wallet's recent transactions and exits non-zero if any
gateway-submitted transaction is missing the configured `SOURCE_TAG`.
