# @xrpl-x402/server

x402 **middleware** for sellers. Price any Express or Fastify route per call in
XRP or RLUSD on the XRP Ledger. The middleware delegates every verify/settle
decision to the gateway facilitator, so it holds no XRPL code and no duplicated
x402 protocol logic.

```bash
npm i @xrpl-x402/server
```

Requires Node ≥ 20. `express` and `fastify` are optional peer dependencies:
install only the one you use.

## How it works

```text
 client                      your server                     gateway
                          (x402 middleware)               (facilitator)
  |                               |                             |
  |-------- GET /premium --------->                             |
  |                               |------ POST /challenge ------>
  <------- 402 + accepts[] -------|                             |
  |                               |                             |
  |-- GET /premium + X-PAYMENT --->                             |
  |                               |------- POST /settle -------->
  |                               <---------- SETTLED ----------|
  <-- 200 + X-PAYMENT-RESPONSE ---|                             |
```

An unpaid request gets a `402` carrying the payment requirements. Once the
client retries with an `X-PAYMENT` header and the facilitator returns `SETTLED`,
your route handler runs normally and the response carries
`X-PAYMENT-RESPONSE`.

Pricing (amount, asset, payTo, mode) lives in the seller's **gateway
registration**, the single source of truth, not in the middleware config. The
middleware only needs the facilitator URL and the registered `sellerId`.

## Register the seller once

```bash
curl -X POST http://localhost:8402/sellers -H 'content-type: application/json' -d '{
  "name": "My Priced API",
  "originUrl": "http://localhost:3000",
  "payToAddress": "rSellerXRPLAddress...",
  "priceAmount": "0.01",
  "priceAsset": "XRP",
  "paymentMode": "PAY_PER_CALL"
}'
# → { "sellerId": "…", "gatewayUrl": "…" }
```

## Express

```ts
import express from 'express';
import { x402Express } from '@xrpl-x402/server';

const app = express();
const pay = x402Express({
  gatewayUrl: 'http://localhost:8402',
  sellerId: process.env.SELLER_ID!,
});

app.get('/premium', pay, (_req, res) => {
  res.json({ secret: 42 });
});

app.listen(3000);
```

## Fastify

```ts
import Fastify from 'fastify';
import { x402Fastify } from '@xrpl-x402/server';

const app = Fastify();
const pay = x402Fastify({
  gatewayUrl: 'http://localhost:8402',
  sellerId: process.env.SELLER_ID!,
});

app.get('/premium', { preHandler: pay }, async () => ({ secret: 42 }));

await app.listen({ port: 3000 });
```

Clients pay transparently with `x402fetch` from
[`@xrpl-x402/client`](https://www.npmjs.com/package/@xrpl-x402/client).

## License

MIT. Source: [tekvyy/x402-xrpl](https://github.com/tekvyy/x402-xrpl).
