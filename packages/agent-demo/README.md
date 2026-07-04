# @app/agent-demo

The headline demo: an autonomous AI agent that **pays for an API per call** over
x402 — no Stripe, no human sign-up, just an XRPL wallet.

## What it does

From a single command the agent:

1. Loads its wallet and reads the seller's payTo address from the gateway.
2. **Opens one PayChan channel** (`PaymentChannelCreate`, source-tagged) and
   registers it with the gateway as a prepaid-credits source.
3. Makes **~20 metered calls off-ledger** — each pays with a signed, monotonic
   channel claim (`X-PAYMENT`), credits tick down, and there is **no per-call
   on-chain wait**.
4. Makes **one pay-per-call request** that settles on chain and prints the
   **explorer URL** as proof of a real XRPL settlement carrying the source tag.

Every payment flows through the same `x402fetch` + gateway path the SDK and
proxy use. The agent adds only the tool-calling orchestration: `createPaidFetchTool`
wraps `x402fetch` as an MCP-style tool (`name` / `description` / `inputSchema` /
`invoke`) that any MCP or LangChain host can expose to a model.

## Run it

The demo transacts in **XRP** (PayChan is XRP-native), so register the seller
with `priceAsset: "XRP"` and `paymentMode: "PREPAID_CREDITS"`. Then:

```bash
export GATEWAY_URL=http://localhost:8402
export SELLER_ID=<seller uuid from POST /sellers>
export AGENT_SEED=sEd...            # funded XRPL wallet seed
export SOURCE_TAG=<your team source tag>
export XRPL_NETWORK=TESTNET         # or MAINNET
export RESOURCE=data                # path under the seller gateway URL
export CHANNEL_DEPOSIT_XRP=1
export METERED_CALLS=20

pnpm --filter @app/agent-demo build
pnpm --filter @app/agent-demo start
```

Expected output (abridged):

```
Agent rAgent… buying from seller <id>
Opening a channel with 1 XRP deposit…
Channel <channelId> open. Credits: 1 XRP.

  call 01/20 → 200 · credits left 0.95 XRP
  …
  call 20/20 → 200 · credits left 0.00 XRP

20 metered calls done off-ledger — no per-call on-chain tx.

Making one pay-per-call request to prove on-chain settlement…
Settled on chain: <txHash>
Explorer: https://testnet.xrpl.org/transactions/<txHash>
```

## Switch mainnet ↔ testnet

Set `XRPL_NETWORK=MAINNET` (or `TESTNET`); override the endpoint with
`XRPL_ENDPOINT` if you run your own node.
