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

## x402 v1 spec compliance

Every wire message follows the [x402 v1 specification](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v1.md)
exactly. XRPL is carried as two payment schemes on the `xrpl` / `xrpl-testnet`
networks:

| Spec primitive                                  | This implementation                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `402` body: `{ x402Version, error, accepts[] }` | Same, with all required `PaymentRequirements` fields (`scheme`, `network`, `maxAmountRequired`, `asset`, `payTo`, `resource`, `description`, `maxTimeoutSeconds`); the challenge nonce and RLUSD issuer ride in `extra` |
| `scheme`                                        | `exact` = direct XRPL `Payment` proven by tx hash (pay-per-call); `paychan` = off-ledger signed PayChan claim (prepaid credits, the XRPL-native analog of EIP-3009 authorizations)                                      |
| `network`                                       | `xrpl` (mainnet) / `xrpl-testnet` (CAIP-2 ids `xrpl:0` / `xrpl:1` reserved for the v2 transport)                                                                                                                        |
| `X-PAYMENT` header                              | Spec envelope `{ x402Version, scheme, network, payload }`, base64 JSON; the `payload` object is scheme-defined                                                                                                          |
| `X-PAYMENT-RESPONSE` header                     | Spec `SettlementResponse` `{ success, errorReason?, transaction, network, payer }` (+ a non-spec `explorerUrl` convenience field)                                                                                       |
| Facilitator `POST /verify`, `POST /settle`      | Spec bodies `{ x402Version, paymentPayload, paymentRequirements }`; spec responses `{ isValid, invalidReason?, payer }` and `{ success, errorReason?, transaction, network, payer }`                                    |
| Facilitator `GET /supported`                    | `{ kinds: [{ x402Version, scheme, network }] }` for both schemes on the configured network                                                                                                                              |

One non-spec convenience endpoint remains: `POST /challenge`, which the server
middleware uses to have the gateway issue nonce-bound challenges (replay
protection is anchored in the gateway's single-use nonce ledger). Spec clients
never call it — they only ever see spec-shaped messages.

## Architecture

```
AI Agent / Client ──(x402fetch: handles 402, pays, retries)──► SELLER'S API
                                                               (@xrpl-x402/server middleware
                                                                on the seller's own routes)
                                                                       │
                                                    delegates /challenge /verify /settle
                                                                       ▼
                                  ┌──────────── GATEWAY (x402 facilitator) ───────────┐
                                  │  • 402 challenge issuer (price, payTo, nonce)      │
                                  │  • /verify  /settle  (XRP + RLUSD)                 │
                                  │  • verifier: onchain Payment  OR  PayChan claim    │
                                  │  • credit ledger + nonces (Postgres)               │
                                  │  • rate limit + auth challenges + pubsub (Redis)   │
                                  │  • usage logger  ──► dashboard (SSE)               │
                                  └──────────────────┬────────────────────────────────┘
                                                     ▼
                                            XRPL (xrpl.js):
                                            verify tx / redeem
                                            PayChan claim, source tag
```

The seller's API stays in the seller's hands — the middleware answers `402`
for unpaid requests and lets paid ones through, delegating every x402
decision to the gateway. Because payment is enforced _in_ the seller's server,
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

PayChan is x402's _shape_ on XRPL, not EIP-3009's _economics_. Two consequences
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

| Package       | Role                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| `shared`      | Types, enums, constants, x402 payload schemas (zod), `loadEnv()`              |
| `gateway`     | Node/Fastify gateway service — x402 facilitator + dashboard API               |
| `sdk-client`  | `x402fetch` + wallet/payment/channel helpers                                  |
| `sdk-server`  | Express/Fastify server middleware (delegates to the gateway)                  |
| `dashboard`   | Vite + React seller dashboard                                                 |
| `agent-demo`  | AI agent demo — pays per call via an MCP-style tool                           |
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

The dashboard (`:5173`) requires a session. Auth is **sign-in-with-XRPL**:
connect a browser wallet (GemWallet, Crossmark, Xaman, WalletConnect via
[xrpl-connect](https://github.com/XRPL-Commons/xrpl-connect)) and sign a
one-time challenge — no transaction is submitted, no fees are charged, and the
seed never leaves the wallet. GemWallet and Crossmark work with zero config;
Xaman needs `VITE_XAMAN_API_KEY` and WalletConnect needs
`VITE_WALLETCONNECT_PROJECT_ID`.

(`pnpm demo` prints a pre-authenticated dashboard URL for its throwaway
testnet seller wallet, so no extension is needed to watch the demo.)

Two tabs:

- **My APIs** — register your APIs and watch live revenue, usage, and the
  settlement feed (scoped to your signed-in address).
- **My Bots** — configure self-custody paying agents (seller, spend caps,
  deposit) and download a ready-to-run `.env` + run command. The bot seed stays
  with you; the gateway stores only the config and the bot's public address.

## Facilitator endpoints

Thin HTTP wrappers over the core x402 services:

- `POST /challenge` — issue a single-use nonce for a registered seller
  (non-spec; used by the server middleware).
- `POST /settle` — spec facilitator settle: verify + consume a payment; body
  `{ x402Version, paymentPayload, paymentRequirements }`, response
  `{ success, errorReason?, transaction, network, payer }`.
- `POST /verify` — spec facilitator verify (no consume); response
  `{ isValid, invalidReason?, payer }`.
- `GET /supported` — spec facilitator capability listing:
  `{ kinds: [{ x402Version, scheme, network }] }`.
- `GET /catalog` — public service registry: every registered API (name, price,
  modes, `channelDestination`) as JSON, so agents can discover what is payable.
  The dashboard's public landing page renders the same registry for humans.

Server middleware (`@xrpl-x402/server`) is pure delegation — it holds no XRPL or
verify logic. Config is just `{ gatewayUrl, sellerId }`; pricing lives in the
gateway seller registration (single source of truth).

## Configuration

Copy `.env.example` to `.env`. Key vars:

| Var                           | Purpose                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLED_NETWORKS`            | Networks served, comma-separated: `TESTNET`, `MAINNET`, or both                                                                                                                           |
| `GATEWAY_XRPL_SEED_<NETWORK>` | Gateway wallet seed **per enabled network** (e.g. `GATEWAY_XRPL_SEED_TESTNET`)                                                                                                            |
| `XRPL_ENDPOINT_<NETWORK>`     | Override that network's WebSocket endpoint (optional)                                                                                                                                     |
| `RLUSD_ISSUER_<NETWORK>`      | Override that network's RLUSD issuer (optional; Ripple's are built in)                                                                                                                    |
| `AUTH_SECRET`                 | Signs dashboard session tokens (≥ 16 chars)                                                                                                                                               |
| `SOURCE_TAG`                  | Stamped on every gateway-submitted XRPL tx (shared across networks)                                                                                                                       |
| `DATABASE_URL`                | Postgres — durable ledger/usage/sellers                                                                                                                                                   |
| `REDIS_URL`                   | Redis — rate limit, sign-in challenges, live-feed pub/sub                                                                                                                                 |
| `GATEWAY_PORT`                | Gateway HTTP port (default `8402`)                                                                                                                                                        |
| `DASHBOARD_ORIGIN`            | Allowed dashboard origin (CORS)                                                                                                                                                           |
| `ESCROW_ENABLED`              | Custodial escrow-credits fallback (default `false`; the authentic path is PayChan)                                                                                                        |
| `PLATFORM_FEE_BPS`            | Platform fee in basis points on the PayChan credits path (default `0` = off). When set, channels open to the gateway, which redeems on chain and forwards the seller's cut minus the fee. |

### Mainnet and testnet together

One deployment serves both. `ENABLED_NETWORKS` picks which, each needs its own
`GATEWAY_XRPL_SEED_<NETWORK>`, and a **seller chooses its own networks** at
registration — so the 402 `accepts[]` offers a caller one group of entries per
network. A testnet-only deployment never needs mainnet keys or funds.

Network is bound to the challenge nonce (one challenge row per network), so
settle resolves the ledger from persisted state rather than config, and a free
testnet payment can never satisfy a mainnet challenge. See `MAINNET.md`.

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
