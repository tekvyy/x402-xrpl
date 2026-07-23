# Enabling mainnet

The gateway serves **several XRPL networks at once**. Testnet and mainnet run
side by side in one deployment, sharing one database, and a seller chooses which
networks its API is payable on. Enabling mainnet is therefore additive: nothing
is switched over, and the free testnet path keeps working exactly as before.

Deployment lives at `xrplfi.com` (dashboard) and `api.xrplfi.com` (gateway).

## How multi-network works

- **`ENABLED_NETWORKS`** lists what the gateway serves (`TESTNET`,
  `TESTNET,MAINNET`, …). Every enabled network uses `GATEWAY_XRPL_SEED` (one seed
  derives the same address on each ledger); set a per-network
  `GATEWAY_XRPL_SEED_<NETWORK>` only to use a _different_ wallet on that network.
  A testnet-only deployment never needs mainnet keys or real funds.
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
| `x402-xrpl-backend` | `ENABLED_NETWORKS`  | `TESTNET`             |
| `x402-xrpl-backend` | `GATEWAY_XRPL_SEED` | (testnet wallet seed) |
| `x402-xrpl-backend` | `SOURCE_TAG`        | `2606150004`          |

`XRPL_NETWORK` and `RLUSD_ISSUER` are left over from the single-network config
and are now ignored (unknown keys are stripped); delete them. On
`admin-dashboard`, `VITE_XRPL_NETWORK` is also dead — the network is a UI toggle
now. RLUSD issuers are built into `packages/shared/src/constants.ts` per network,
so `RLUSD_ISSUER_<NETWORK>` only exists as an override.

Nothing needs renaming: the existing `GATEWAY_XRPL_SEED` already boots the
testnet-only deployment.

## Add mainnet (optional, costs real XRP)

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

### Turn mainnet on

```bash
grep '^GATEWAY_XRPL_SEED_MAINNET=' .env.mainnet | cut -d= -f2- \
  | railway variables --service x402-xrpl-backend --skip-deploys \
      --set-from-stdin GATEWAY_XRPL_SEED_MAINNET

railway variables --service x402-xrpl-backend --set "ENABLED_NETWORKS=TESTNET,MAINNET"
```

The second command has no `--skip-deploys`, so it triggers the deploy.

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
`SELLER_ADDRESS` from `.env.mainnet`, price `0.01` XRP, asset `XRP`, setup
`Both`, origin `http://localhost:8403`.

The origin URL is only ever fetched by the paying agent, not by the gateway
(`resourceBase = seller.originUrl` in `packages/agent-demo/src/agent.ts`), so a
local origin still settles on mainnet.

Terminal 1 — the seller's API:

```bash
pnpm build
GATEWAY_URL=https://api.xrplfi.com SELLER_ID=<seller-id> DEMO_ORIGIN_PORT=8403 \
  pnpm --filter @app/demo-origin start
```

Terminal 2 — the paying agent:

```bash
set -a && . ./.env.mainnet && set +a
GATEWAY_URL=https://api.xrplfi.com \
SELLER_ID=<seller-id> \
SOURCE_TAG=2606150004 \
XRPL_NETWORK=MAINNET \
RESOURCE=data CHANNEL_DEPOSIT_XRP=1 METERED_CALLS=20 \
  pnpm --filter @app/agent-demo start
```

`XRPL_NETWORK` here is the **agent's** own setting — a client pays on one
network per run. It is unrelated to the gateway's `ENABLED_NETWORKS`.

This puts three real transactions on mainnet, each carrying source tag
2606150004:

1. `PaymentChannelCreate` — the agent opens a 1 XRP prepaid channel
2. `Payment` — one pay-per-call settlement (prints its explorer URL)
3. `PaymentChannelClaim` — the gateway redeems the channel on chain

The 20 metered calls in between are deliberately **off-ledger** — that is the
point of the credits path.

## Prove the source tag on chain

`loadEnv` validates the full env schema, so source `.env` first for the
unrelated required keys, then `.env.mainnet` for the real seed:

```bash
set -a && . ./.env && . ./.env.mainnet && set +a
ENABLED_NETWORKS=TESTNET,MAINNET SOURCE_TAG=2606150004 \
  pnpm --filter @app/gateway audit:source-tag
```

The audit walks **every enabled network** and exits non-zero if any transaction
is missing the tag:

```
[TESTNET] PASS: all N gateway transaction(s) carry source tag 2606150004.
[MAINNET] PASS: all N gateway transaction(s) carry source tag 2606150004.

PASS: audited N transaction(s) across TESTNET, MAINNET.
```

This is the artifact to show during validation — read from the ledger, not from
application logs.

## Turning mainnet back off

```bash
railway variables --service x402-xrpl-backend --set "ENABLED_NETWORKS=TESTNET"
```

Sellers advertising mainnet stop being payable on it (`payableNetworks` drops
it) and testnet is unaffected. If any mainnet channel still holds unredeemed
value, the maintenance sweep logs it loudly per row rather than silently
stranding it — redeem before disabling.

## Cost

At 0.01 XRP per call, a 20-call run plus the channel costs well under 2 XRP
including fees. The ~11 XRP funding target is mostly refundable reserve.
