/**
 * The agent skill: a self-contained markdown document teaching any AI agent
 * (or its developer) how to discover services and pay for API calls through
 * this gateway: raw wire protocol, no SDK required. Served at `GET /skill.md`
 * so agents fetch it straight from the deployment it describes; `/llms.txt`
 * aliases it for tools that look there by convention.
 */
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';

function agentSkill(gatewayUrl: string): string {
  return `# Skill: pay for APIs with XRP over x402

You are an agent with an XRPL wallet. This gateway is an x402 facilitator on
the XRP Ledger: sellers register HTTP APIs with a per-call price, and you pay
per request: no signup, no API key, no credit card. This document is the full
wire protocol; any HTTP client that can sign XRPL transactions can pay.

Facilitator base URL: ${gatewayUrl}

## Networks

Two networks are served, each a separate marketplace with its own registry:

| x402 \`network\` id | Ledger        | Money                             |
| ------------------ | ------------- | --------------------------------- |
| \`xrpl-testnet\`   | XRPL Testnet  | Free faucet XRP. Try things here |
| \`xrpl\`           | XRPL Mainnet  | Real XRP / RLUSD                  |

Testnet wallets: fund at https://xrpl.org/resources/dev-tools/xrp-faucets.
WebSocket endpoints: \`wss://s.altnet.rippletest.net:51233\` (testnet),
\`wss://xrplcluster.com\` (mainnet).

## 1. Discover services

\`\`\`
GET ${gatewayUrl}/catalog
\`\`\`

Returns \`{ networks, facilitator, services: [...] }\`. Each service:

- \`sellerId\`: UUID identifying the API on this gateway
- \`originUrl\`: the API's own base URL (this is what you call)
- \`priceAmount\` / \`priceAsset\`: per-call price, in \`XRP\` or \`RLUSD\`
- \`paymentMode\`: \`PAY_PER_CALL\`, \`PREPAID_CREDITS\`, or \`BOTH\`
- \`payableNetworks\`: where you can pay (\`TESTNET\` / \`MAINNET\`)
- \`channelDestinations\`: per network, the address to open a prepaid
  payment channel to (see §3)

A single seller resolves at \`GET ${gatewayUrl}/sellers/{sellerId}\`.

## 2. Pay per call (the \`exact\` scheme)

1. Request the resource, e.g. \`GET {originUrl}/data\`. You get
   \`402 Payment Required\` with body \`{ x402Version: 1, error, accepts: [...] }\`.
2. Pick an entry from \`accepts[]\` matching your scheme (\`exact\`), network,
   and asset. It carries: \`maxAmountRequired\` (drops for XRP, decimal units
   for RLUSD), \`payTo\`, \`maxTimeoutSeconds\`, and \`extra.nonce\`, a
   single-use nonce binding your payment to this challenge.
3. Submit an XRPL \`Payment\`:
   - \`Destination\`: the entry's \`payTo\`
   - \`Amount\`: \`maxAmountRequired\` verbatim (drops string for XRP; for
     RLUSD an amount object \`{ currency, issuer: extra.issuer, value }\`
     where \`currency\` is the 160-bit hex of \`RLUSD\`)
   - \`Memos\`: one memo whose \`MemoData\` is the hex of the UTF-8 nonce
   - wait for validation; keep the transaction hash
4. Retry the exact same request with header \`X-PAYMENT\` set to
   base64(JSON) of:

\`\`\`json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "<network id from the accepts entry>",
  "payload": {
    "nonce": "<extra.nonce>",
    "asset": "XRP",
    "txHash": "<payment tx hash>",
    "payer": "<your classic address>"
  }
}
\`\`\`

5. The response is the real API response. Its \`X-PAYMENT-RESPONSE\` header is
   base64(JSON) \`{ success, transaction, network, payer, explorerUrl? }\`,
   your on-chain settlement receipt.

## 3. Prepaid credits (the \`paychan\` scheme)

Calling one service many times? Open an XRPL payment channel once, then pay
each call off-ledger by signing claims, with no per-call on-chain wait. XRP only.

1. Open: submit \`PaymentChannelCreate\` with \`Destination\` =
   \`channelDestinations[network]\` from the seller info, \`Amount\` = your
   deposit in drops, \`SettleDelay\` = 86400, \`PublicKey\` = your wallet's
   public key. The channel id is the created \`PayChannel\` ledger entry's
   index (in the tx metadata).
2. Register it so the gateway accepts claims against it:

\`\`\`
POST ${gatewayUrl}/channels
{ "channelId": "...", "sellerId": "...", "walletAddress": "<your address>",
  "network": "TESTNET" | "MAINNET" }
\`\`\`

3. Per call: on the 402, pick the \`paychan\` entry from \`accepts[]\`, add the
   price to your running total (drops), sign a claim over
   \`(channelId, cumulativeTotal)\` (xrpl.js: \`signPaymentChannelClaim(channelId,
   totalInXrp, privateKey)\`, which takes XRP, not drops), and retry with
   \`X-PAYMENT\` = base64(JSON) of:

\`\`\`json
{
  "x402Version": 1,
  "scheme": "paychan",
  "network": "<network id>",
  "payload": {
    "nonce": "<extra.nonce>",
    "asset": "XRP",
    "channelId": "<channel id>",
    "cumulativeAmount": "<new cumulative total, drops>",
    "signature": "<claim signature>",
    "payer": "<your classic address>"
  }
}
\`\`\`

Claims must be strictly monotonic: only advance your cumulative total after a
non-402 response. The gateway redeems the accumulated total on chain later.

## Rules and gotchas

- Every nonce is single-use and expires after \`maxTimeoutSeconds\`. On a new
  402, use the new nonce and never replay an old payment.
- Never pay on chain against a seller whose \`accepts[]\` offers only
  \`paychan\`: the gateway would reject the scheme after your funds moved.
  Open a channel instead.
- Guard your spend: compare \`maxAmountRequired\` against your own ceiling
  before paying. Prices are seller-controlled.
- RLUSD payments need a trustline to the issuer in \`extra.issuer\` first
  (\`TrustSet\`); RLUSD is pay-per-call only.
- A payment on one network never satisfies a challenge on the other.
- Facilitator self-description: \`GET ${gatewayUrl}/supported\` lists every
  supported (scheme, network) pair.

## TypeScript shortcut

The reference SDK wraps all of the above in one call. The repo ships
\`@xrpl-x402/client\` with \`x402fetch(url, { x402: { wallet, client,
sourceTag, maxAmount, channel? } })\` handling 402 → pay → retry
transparently: https://github.com/tekvyy/x402-xrpl
`;
}

export function registerSkillRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const markdown = agentSkill(deps.publicBaseUrl);
  for (const path of ['/skill.md', '/llms.txt']) {
    app.get(path, async (_request, reply) => {
      return reply.header('content-type', 'text/markdown; charset=utf-8').send(markdown);
    });
  }
}
