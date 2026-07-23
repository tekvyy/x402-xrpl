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

The demo signs the seller in with sign-in-with-XRPL before registering (seller
registration now requires an authenticated session).

Servers stay up afterwards so the live dashboard can be watched. Press `Ctrl-C`
to tear everything down.

## Dashboard sign-in

The dashboard (`:5173`) requires a session. Authentication is
**sign-in-with-XRPL** (via [xrpl-connect](https://github.com/XRPL-Commons/xrpl-connect)):
you sign a one-time challenge with your wallet — the seed never leaves it.

Click _Connect <wallet>_ on the login screen (GemWallet / Crossmark / Xaman /
WalletConnect). The dashboard requests a challenge, has the wallet sign a
throwaway (never-submitted) `AccountSet` whose memo carries the nonce, and the
gateway verifies the signed tx blob server-side (deterministic,
wallet-agnostic). GemWallet and Crossmark work with zero config; Xaman needs
`VITE_XAMAN_API_KEY` and WalletConnect needs `VITE_WALLETCONNECT_PROJECT_ID`
(adapters load only when their key is set).

The demo's seller wallet is a faucet-funded throwaway no extension holds, so
the orchestrator signs it in headlessly and prints a **pre-authenticated
dashboard URL** (`http://localhost:5173/#token=…`) at the end of the run — open
that to watch the demo without any wallet setup.

Once in, two tabs:

- **My APIs** — register origin APIs and watch their live revenue, usage, and
  settlement feed (scoped to your signed-in address).
- **My Bots** — configure self-custody paying agents (which seller, spend caps,
  deposit) and download a ready-to-run `.env` + run command. The bot's seed
  stays with you; the gateway only stores the config and the bot's public
  paying address (for spend monitoring).

## Mainnet vs testnet

The demo runs testnet-only so wallets can be faucet-funded. The gateway itself
serves whatever `ENABLED_NETWORKS` lists, so **mainnet is additive, not a
switch**: set `ENABLED_NETWORKS=TESTNET,MAINNET` plus a funded
`GATEWAY_XRPL_SEED_MAINNET`, and sellers choose which networks to advertise on.
Every gateway-submitted transaction carries the configured `SOURCE_TAG` on
every network. See `MAINNET.md`.

## Source-tag audit

After settlements exist on the gateway wallet, verify the on-chain
source-tag guarantee:

```bash
pnpm audit:source-tag
```

Scans the gateway wallet's recent transactions and fails (non-zero exit) if any
gateway-submitted transaction is missing the configured `SOURCE_TAG`.
