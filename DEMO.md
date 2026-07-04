# Demo & operations

## One-command demo

```bash
pnpm demo
```

Prerequisites: Postgres and Redis reachable via `DATABASE_URL` / `REDIS_URL`
(copy `.env.example` to `.env` first). The script:

1. Builds every package (`pnpm -r build`).
2. Applies migrations (`pnpm migrate:up`).
3. Faucet-funds three fresh **testnet** wallets — gateway, agent, seller.
4. Boots `demo-origin` (`:8403`), `gateway` (`:8402`), and the `dashboard` (`:5173`).
5. Registers a demo seller whose origin is `demo-origin` and price is `0.01 XRP`.
6. Runs the agent demo: open one PayChan channel → **20 off-ledger metered
   calls** (credits tick down, no per-call on-chain wait) → **one pay-per-call**
   request that settles on chain, printing the explorer URL.

Servers stay up afterwards so the live dashboard can be watched (enter the
printed seller id). Press `Ctrl-C` to tear everything down.

## Mainnet vs testnet

The demo forces `XRPL_NETWORK=TESTNET` so wallets can be faucet-funded. To run
against **mainnet**, start the packages individually with a real, funded
`GATEWAY_XRPL_SEED` and `XRPL_NETWORK=MAINNET` (the only network-dependent knobs
are `XRPL_NETWORK` / `XRPL_ENDPOINT` and the `RLUSD_ISSUER` for that network —
see `.env.example`). Every gateway-submitted transaction carries the configured
`SOURCE_TAG` on both networks.

## Source-tag audit

After settlements exist on the gateway wallet, verify the on-chain
source-tag guarantee:

```bash
pnpm audit:source-tag
```

Scans the gateway wallet's recent transactions and fails (non-zero exit) if any
gateway-submitted transaction is missing the configured `SOURCE_TAG`.
