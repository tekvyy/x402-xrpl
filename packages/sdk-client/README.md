# @xrpl-x402/client

x402 **payment client** for the XRP Ledger. `x402fetch` is a drop-in `fetch`
that handles an HTTP `402 Payment Required`, pays it, and retries, so a caller
(or an AI agent) can buy an API call with no signup, no API key, and no payment
processor.

```bash
npm i @xrpl-x402/client
```

Requires Node ≥ 20.

## Pay per call

One on-chain XRPL `Payment` per request. `maxAmount` is a hard per-call ceiling:
a challenge above it throws `MaxAmountExceededError` before any money moves.

```ts
import { Client, Wallet } from 'xrpl';
import { x402fetch, readSettlement } from '@xrpl-x402/client';

const client = new Client('wss://s.altnet.rippletest.net:51233');
await client.connect();
const wallet = Wallet.fromSeed(process.env.XRPL_SEED!);

const res = await x402fetch('https://seller.example.com/data', {
  x402: { wallet, client, sourceTag: 0, maxAmount: { XRP: '0.05' } },
});

console.log(await res.json());
console.log(readSettlement(res)?.transaction); // settled tx hash
```

## Prepaid credits (payment channels)

For repeat calls to one seller, open a payment channel once and then pay
**off-ledger** with signed, monotonically increasing claims. There is no
per-call on-chain wait and no per-call fee: N calls settle as 2 transactions,
which is what makes per-call pricing at a fraction of a cent workable.

```ts
import { openChannel, x402fetch } from '@xrpl-x402/client';

const channel = await openChannel({
  client,
  wallet,
  destination: '<channelDestination from the gateway /catalog>',
  deposit: '1', // XRP
  sourceTag: 0,
});

for (let i = 0; i < 100; i++) {
  await x402fetch('https://seller.example.com/data', {
    x402: { wallet, client, sourceTag: 0, channel },
  });
}
```

Register the channel with the gateway (`POST /channels`) before its claims are
honored. Credits are XRP-only, because payment channels are XRP-native; price in
RLUSD and calls settle via the pay-per-call path instead.

## What else is in here

- `openChannel`, `signClaim`, `hasCredits` for the channel lifecycle
- `ensureTrustline` to set up RLUSD before paying in it
- `payChallenge` to settle a challenge manually
- `loadWallet`, `createClient`, `ensureConnected` wallet helpers
- `readSettlement` to read the `X-PAYMENT-RESPONSE` settlement result

Sellers meter their routes with
[`@xrpl-x402/server`](https://www.npmjs.com/package/@xrpl-x402/server). Agents
that would rather speak the wire protocol with no SDK can fetch `/skill.md` from
any gateway deployment.

## License

MIT. Source: [tekvyy/x402-xrpl](https://github.com/tekvyy/x402-xrpl).
