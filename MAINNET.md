# Mainnet

The gateway serves **testnet and mainnet at once, always**. They run side by
side in one deployment, sharing one database, users toggle between them in the
dashboard, and a seller chooses which networks its API is payable on. The free
testnet path keeps working exactly as before regardless of mainnet activity.

Deployment lives at `xrplfi.com` (dashboard) and `api.xrplfi.com` (gateway).

## How multi-network works

- **Both networks use `GATEWAY_XRPL_SEED`** (one seed derives the same address
  on each ledger); set a per-network `GATEWAY_XRPL_SEED_<NETWORK>` only to use
  a _different_ wallet on that network. The mainnet wallet must be funded on
  mainnet before mainnet settlements can happen; until then mainnet requests
  fail at settlement, not at boot.
- **A seller picks its networks** at registration (`networks: ["TESTNET"]`,
  `["TESTNET","MAINNET"]`, …). The 402 `accepts[]` carries one group of entries
  per network, so a caller chooses where to pay.
- **The nonce binds the network.** `issueChallenge` writes one challenge row per
  network, each with its own nonce. `settle` resolves the network from the
  challenge it looked up — never from config — so a free testnet payment can
  never satisfy a mainnet challenge. The gate is `loadChallenge` in
  `packages/gateway/src/services/settle.service.ts`.
- **Every ledger identifier is network-scoped** in Postgres: `payments.tx_hash`,
  `channels.channel_id`, and `escrow_credits.deposit_tx_hash` are unique per
  `(network, …)`, not globally. This matters — a PayChan id is derived from
  (account, destination, sequence), so the same wallet running the same flow on
  both networks produces the _same_ channel id.

## Current state

| Service             | Variable            | Value                 |
| ------------------- | ------------------- | --------------------- |
| `x402-xrpl-backend` | `GATEWAY_XRPL_SEED` | (gateway wallet seed) |
| `x402-xrpl-backend` | `SOURCE_TAG`        | `2606150004`          |

`ENABLED_NETWORKS` is gone: both networks are always served, so delete the
variable if it is still set (unknown keys are stripped, but keeping it around
misleads). `XRPL_NETWORK` and `RLUSD_ISSUER` are likewise leftovers from the
single-network config; delete them too. On `admin-dashboard`,
`VITE_XRPL_NETWORK` is also dead — the network is a UI toggle now. RLUSD
issuers are built into `packages/shared/src/constants.ts` per network, so
`RLUSD_ISSUER_<NETWORK>` only exists as an override.

## Fund the mainnet wallet (costs real XRP)

### Generate and fund wallets

```bash
node scripts/gen-mainnet-wallets.mjs   # writes .env.mainnet, mode 0600, gitignored
```

| Wallet    | Fund with | Why                                                             |
| --------- | --------- | --------------------------------------------------------------- |
| `GATEWAY` | ~3 XRP    | 1 XRP base reserve + fees for channel redemption                |
| `AGENT`   | ~6 XRP    | 1 XRP reserve + 0.2 owner reserve for the channel + the deposit |
| `SELLER`  | ~2 XRP    | 1 XRP reserve; the account must exist on ledger to receive      |

**Back up `.env.mainnet`.** Then verify funding:

```bash
node scripts/check-mainnet-wallets.mjs
```

Only public addresses are queried; seeds never leave the machine.

### Point the gateway at the funded wallet

```bash
grep '^GATEWAY_XRPL_SEED_MAINNET=' .env.mainnet | cut -d= -f2- \
  | railway variables --service x402-xrpl-backend \
      --set-from-stdin GATEWAY_XRPL_SEED_MAINNET
```

This triggers a deploy. Alternatively, fund the shared `GATEWAY_XRPL_SEED`
wallet's address on mainnet and set nothing at all.

### Verify

```bash
curl -s https://api.xrplfi.com/supported
```

Should list **four** kinds — `exact` and `paychan` on both `xrpl-testnet` and
`xrpl`. Existing testnet sellers keep working untouched; they simply do not
advertise mainnet until their `networks` list says so.

## Produce mainnet transactions

Register a seller on <https://xrplfi.com> (sign in with GemWallet or Crossmark)
with **Mainnet** ticked in "Networks callers can pay on", payTo set to
`SELLER_ADDRESS` from `.env.mainnet`, price `0.01` XRP, asset `XRP`, and setup
`Both`.

The origin URL is only ever fetched by the paying client, never by the gateway,
so a seller API running on `localhost` still settles on mainnet. Put
`@xrpl-x402/server` in front of a route (see the README) and point a client at
it with `x402fetch`, configured for `XrplNetwork.MAINNET` and funded from
`AGENT_SEED` in `.env.mainnet`.

A client that opens a channel, makes metered calls, and then makes one
pay-per-call request puts three real transactions on mainnet, each carrying the
configured source tag:

1. `PaymentChannelCreate`, the client opening a prepaid channel
2. `Payment`, one pay-per-call settlement
3. `PaymentChannelClaim`, the gateway redeeming the channel on chain

The metered calls in between are deliberately **off-ledger**; that is the point
of the credits path. The network a client pays on is the client's own setting
and says nothing about what the gateway serves (always both).

## Prove the source tag on chain

`loadEnv` validates the full env schema, so source `.env` first for the
unrelated required keys, then `.env.mainnet` for the real seed:

```bash
set -a && . ./.env && . ./.env.mainnet && set +a
SOURCE_TAG=2606150004 \
  pnpm --filter @app/gateway audit:source-tag
```

The audit walks **both networks** and exits non-zero if any transaction
is missing the tag:

```
[TESTNET] PASS: all N gateway transaction(s) carry source tag 2606150004.
[MAINNET] PASS: all N gateway transaction(s) carry source tag 2606150004.

PASS: audited N transaction(s) across TESTNET, MAINNET.
```

This is the artifact to show during validation — read from the ledger, not from
application logs.

## Cost

At 0.01 XRP per call, a 20-call run plus the channel costs well under 2 XRP
including fees. The ~11 XRP funding target is mostly refundable reserve.
