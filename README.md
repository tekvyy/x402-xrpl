# x402 on XRPL

An open, self-hostable **x402 facilitator** for the XRP Ledger, plus the server
and client SDKs around it. It lets any HTTP API charge **per call** in **XRP** or
**RLUSD** over the [x402 (HTTP 402 Payment Required)](https://github.com/coinbase/x402)
protocol, with no payment processor, no API keys, and no sign-up.

It is an XRPL port of Coinbase's x402 (originally Base/USDC). The gateway acts
as the x402 facilitator exposing `/verify` and `/settle`, while callers pay with
either a direct XRPL `Payment` (pay-per-call) or off-ledger **Payment Channel
(PayChan)** claims (prepaid credits, XRPL's native analog of Base's EIP-3009
signed authorizations).

The motivating use case is autonomous **AI agents**, which cannot sign up for a
payment processor but can hold an XRPL wallet and pay per API call. The gateway
serves an agent-facing protocol guide at `GET /skill.md` so an agent can learn
to pay by fetching one document from the deployment it is paying.

> **Status:** v0.1, and the packages are not yet published to npm. Testnet and
> mainnet are both served; treat mainnet use as early software and start small.

## x402 v1 spec compliance

Every wire message follows the [x402 v1 specification](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v1.md).
XRPL is carried as two payment schemes on the `xrpl` / `xrpl-testnet` networks:

| Spec primitive                                 | This implementation                                                                                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `402` body `{ x402Version, error, accepts[] }` | Same, with all required `PaymentRequirements` fields (`scheme`, `network`, `maxAmountRequired`, `asset`, `payTo`, `resource`, `description`, `maxTimeoutSeconds`); the challenge nonce and RLUSD issuer ride in `extra` |
| `scheme`                                       | `exact` = direct XRPL `Payment` proven by tx hash (pay-per-call); `paychan` = off-ledger signed PayChan claim (prepaid credits)                                                                                         |
| `network`                                      | `xrpl` (mainnet) / `xrpl-testnet` (CAIP-2 ids `xrpl:0` / `xrpl:1` reserved for the v2 transport)                                                                                                                        |
| `X-PAYMENT` header                             | Spec envelope `{ x402Version, scheme, network, payload }`, base64 JSON; the `payload` object is scheme-defined                                                                                                          |
| `X-PAYMENT-RESPONSE` header                    | Spec `SettlementResponse` `{ success, errorReason?, transaction, network, payer }` (plus a non-spec `explorerUrl` convenience field)                                                                                    |
| Facilitator `POST /verify`, `POST /settle`     | Spec bodies `{ x402Version, paymentPayload, paymentRequirements }`; spec responses `{ isValid, invalidReason?, payer }` and `{ success, errorReason?, transaction, network, payer }`                                    |
| Facilitator `GET /supported`                   | `{ kinds: [{ x402Version, scheme, network }] }` for both schemes on every served network                                                                                                                                |

One non-spec convenience endpoint exists: `POST /challenge`, which the server
middleware uses to have the gateway issue nonce-bound challenges (replay
protection is anchored in the gateway's single-use nonce ledger). Spec clients
never call it; they only ever see spec-shaped messages.

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

The seller's API stays in the seller's hands. The middleware answers `402` for
unpaid requests and lets paid ones through, delegating every x402 decision to
the gateway. Because payment is enforced _in_ the seller's server, there is no
separate unmetered origin URL to leak or bypass.

### Two payment modes

- **Pay-per-call** — the client submits a direct XRPL `Payment` for the exact
  price; the gateway verifies the tx on-ledger and the request is forwarded. One
  on-chain transaction per call.
- **Prepaid credits (PayChan)** — the client opens one Payment Channel, then
  makes many **off-ledger** metered calls by sending monotonically increasing
  signed claims. Credits tick down with no per-call on-chain wait; the gateway
  redeems the channel on chain later. This is the fast path for AI agents, and
  it collapses N paid calls into 2 on-chain transactions.

Each seller picks a **payment setup** at registration: `PAY_PER_CALL`,
`PREPAID_CREDITS`, or `BOTH`. The 402 `accepts[]` advertises one entry per
allowed mode, and the gateway enforces the setup end to end: settles in a
disallowed mode are rejected, channels cannot be opened against
pay-per-call-only sellers, and bots must match the seller's setup. Credits
setups require XRP pricing, because PayChan is XRP-native.

### Known limitations

PayChan is x402's _shape_ on XRPL, not EIP-3009's _economics_. Two consequences
to plan around:

- **Per-seller capital lockup.** Unlike an EIP-3009 authorization drawn from one
  fungible USDC balance, a PayChan channel is per (payer, destination) and must
  be funded on chain up front. An agent that calls many sellers opens (and locks
  capital in) a channel per seller; the first call to a new seller still costs an
  on-chain channel open or a pay-per-call.
- **RLUSD has no off-ledger fast path.** PayChan is XRP-native, so prepaid
  credits are XRP-only. Pricing in RLUSD works only via pay-per-call (one
  on-chain settlement per call). Stable-unit pricing and the off-ledger fast
  path are mutually exclusive today.

The gateway safeguards the credits path: it rejects channels whose `SettleDelay`
or `CancelAfter` leave too little runway to redeem, stops honoring claims near
expiry, and auto-redeems on chain as a channel fills, so delivered value is
pulled before a channel can be closed and its deposit reclaimed.

## Monorepo layout

pnpm workspaces, TypeScript (NodeNext, strict).

| Package             | Role                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `@app/shared`       | Types, enums, constants, x402 payload schemas (zod), `loadEnv()` |
| `@app/gateway`      | Node/Fastify gateway service — x402 facilitator + dashboard API  |
| `@xrpl-x402/client` | `x402fetch` plus wallet / payment / channel helpers              |
| `@xrpl-x402/server` | Express + Fastify middleware (delegates to the gateway)          |
| `@app/dashboard`    | Vite + React seller dashboard                                    |

## Running the gateway

Prerequisites: **Node ≥ 20**, **pnpm**, and reachable **Postgres** + **Redis**.

```bash
pnpm install
cp .env.example .env         # then edit values (see Configuration)
make up                      # optional: Postgres + Redis via docker compose
pnpm migrate:up
pnpm build
pnpm --filter @app/gateway start      # gateway on :8402
pnpm --filter @app/dashboard dev      # dashboard on :5173
```

Check it is live and serving both networks:

```bash
curl -s localhost:8402/supported
```

That should list four kinds: `exact` and `paychan`, on `xrpl-testnet` and
`xrpl`. `GET /catalog` returns the public registry of every API registered on
the deployment, and `GET /skill.md` returns the agent-facing protocol guide.

## Metering an API (sellers)

Register your API in the dashboard (price, asset, payTo address, payment setup,
networks), then put the middleware in front of the routes you want to charge
for. Pricing is **not** repeated in the middleware config; the gateway
registration is the single source of truth.

```ts
import express from 'express';
import { x402Express } from '@xrpl-x402/server';

const app = express();

app.use(
  '/data',
  x402Express({
    gatewayUrl: 'https://your-gateway.example.com',
    sellerId: '<your-seller-id>',
  }),
);

app.get('/data', (_req, res) => res.json({ answer: 42 }));
```

Unpaid requests get a spec-shaped `402` with the payment requirements; paid ones
reach your handler with an `X-PAYMENT-RESPONSE` header attached.

## Paying for an API (clients and agents)

`x402fetch` is a drop-in `fetch` that handles the 402, pays, and retries:

```ts
import { Client, Wallet } from 'xrpl';
import { x402fetch, openChannel, readSettlement } from '@xrpl-x402/client';

const client = new Client('wss://s.altnet.rippletest.net:51233');
await client.connect();
const wallet = Wallet.fromSeed(process.env.XRPL_SEED!);

// Pay-per-call: one on-chain Payment per request.
const res = await x402fetch('https://seller.example.com/data', {
  x402: { wallet, client, sourceTag: 0, maxAmount: { XRP: '0.05' } },
});
console.log(await res.json(), readSettlement(res)?.transaction);

// Prepaid credits: open one channel, then pay off-ledger per call.
const channel = await openChannel({
  client,
  wallet,
  destination: '<channelDestination from GET /catalog>',
  deposit: '1',
  sourceTag: 0,
});

for (let i = 0; i < 100; i++) {
  await x402fetch('https://seller.example.com/data', {
    x402: { wallet, client, sourceTag: 0, channel },
  });
}
```

The channel must be registered with the gateway before its claims are honored
(`POST /channels`). Agents that would rather speak the wire protocol directly,
with no SDK, should fetch `GET /skill.md` from the gateway: it documents the
full protocol plus XRPL wallet handling discipline.

## Dashboard sign-in

The dashboard requires a session, and auth is **sign-in-with-XRPL**: connect a
browser wallet (GemWallet, Crossmark, Xaman, WalletConnect via
[xrpl-connect](https://github.com/XRPL-Commons/xrpl-connect)) and sign a
one-time challenge. No transaction is submitted, no fees are charged, and the
seed never leaves the wallet. GemWallet and Crossmark work with zero config;
Xaman needs `VITE_XAMAN_API_KEY` and WalletConnect needs
`VITE_WALLETCONNECT_PROJECT_ID`.

Two tabs:

- **My APIs** — register APIs and watch live revenue, usage, and the settlement
  feed, scoped to your signed-in address.
- **My Bots** — configure self-custody paying agents (seller, spend caps,
  deposit) and download a ready-to-run `.env`. The bot seed stays with you; the
  gateway stores only the config and the bot's public address.

## Facilitator endpoints

Thin HTTP wrappers over the core x402 services:

- `POST /challenge` — issue a single-use nonce for a registered seller
  (non-spec; used by the server middleware).
- `POST /settle` — spec facilitator settle: verify and consume a payment.
- `POST /verify` — spec facilitator verify (no consume).
- `GET /supported` — spec facilitator capability listing.
- `GET /catalog` — public service registry: every registered API (name, price,
  modes, `channelDestination`) as JSON, so agents can discover what is payable.
- `GET /skill.md` — the agent-facing protocol guide (aliased at `/llms.txt`).

## Configuration

Copy `.env.example` to `.env`. Key vars:

| Var                       | Purpose                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_XRPL_SEED`       | Gateway wallet seed; covers both networks (same address on each). `GATEWAY_XRPL_SEED_<NETWORK>` overrides it for a different wallet per network                                          |
| `XRPL_ENDPOINT_<NETWORK>` | Override that network's WebSocket endpoint (optional)                                                                                                                                    |
| `RLUSD_ISSUER_<NETWORK>`  | Override that network's RLUSD issuer (optional; Ripple's are built in)                                                                                                                   |
| `AUTH_SECRET`             | Signs dashboard session tokens (≥ 16 chars)                                                                                                                                              |
| `SOURCE_TAG`              | Stamped on every gateway-submitted XRPL tx, so its on-chain activity is attributable                                                                                                     |
| `DATABASE_URL`            | Postgres — durable ledger / usage / sellers                                                                                                                                              |
| `REDIS_URL`               | Redis — rate limit, sign-in challenges, live-feed pub/sub                                                                                                                                |
| `GATEWAY_PORT`            | Gateway HTTP port (default `8402`)                                                                                                                                                       |
| `DASHBOARD_ORIGIN`        | Allowed dashboard origin (CORS)                                                                                                                                                          |
| `ESCROW_ENABLED`          | Custodial escrow-credits fallback (default `false`; the native path is PayChan)                                                                                                          |
| `PLATFORM_FEE_BPS`        | Platform fee in basis points on the PayChan credits path (default `0` = off). When set, channels open to the gateway, which redeems on chain and forwards the seller's cut minus the fee |

### Mainnet and testnet together

Every deployment serves both. Each network needs a funded gateway wallet
(`GATEWAY_XRPL_SEED` covers both, or use per-network overrides), and a **seller
chooses its own networks** at registration, so the 402 `accepts[]` offers one
group of entries per network. Users toggle networks in the dashboard.

The network is bound to the challenge nonce (one challenge row per network), so
settle resolves the ledger from persisted state rather than config, and a free
testnet payment can never satisfy a mainnet challenge. See
[`MAINNET.md`](MAINNET.md).

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

Conventions and architecture notes live in [`AGENTS.md`](AGENTS.md); deployment
notes are in [`docs/railway.md`](docs/railway.md).

### Source-tag audit

Every transaction the gateway submits carries the configured `SOURCE_TAG`. After
settlements exist, verify that on chain rather than from application logs:

```bash
pnpm audit:source-tag
```

It scans the gateway wallet's recent transactions on every served network and
exits non-zero if any gateway-submitted transaction is missing the tag.

## License

[MIT](LICENSE).
