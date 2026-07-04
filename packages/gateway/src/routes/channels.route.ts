/**
 * PayChan channel routes: register an on-ledger channel as a prepaid-credits
 * source, and redeem its accumulated off-ledger claims on chain. The escrow
 * deposit route is registered only when the custodial fallback is enabled.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SettleResult } from '@app/shared';
import { registerChannel, redeemChannel } from '../services/channel.service.js';
import { depositEscrow } from '../services/escrow.service.js';
import type { GatewayDeps } from '../deps.js';

const RegisterChannelSchema = z.object({
  channelId: z.string().min(1),
  sellerId: z.string().uuid(),
  walletAddress: z.string().min(25),
});

const EscrowDepositSchema = z.object({
  sellerId: z.string().uuid(),
  walletAddress: z.string().min(25),
  txHash: z.string().min(1),
});

export function registerChannelRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  app.post('/channels', async (request, reply) => {
    const parsed = RegisterChannelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid channel', issues: parsed.error.issues });
    }
    const result = await registerChannel(deps, parsed.data);
    if (!result.ok) return reply.code(400).send({ error: result.reason });

    const { channel } = result;
    return reply.code(201).send({
      channelId: channel.channel_id,
      sellerId: channel.seller_id,
      walletAddress: channel.wallet_address,
      asset: channel.asset,
      creditsTotal: channel.credits_total,
      creditsUsed: channel.credits_used,
      status: channel.status,
    });
  });

  app.post<{ Params: { id: string } }>('/channels/:id/redeem', async (request, reply) => {
    const outcome = await redeemChannel(deps, request.params.id);
    if (outcome.result !== SettleResult.SETTLED) {
      return reply.code(400).send({ error: outcome.reason ?? 'redeem rejected' });
    }
    return reply.send({
      result: outcome.result,
      txHash: outcome.txHash,
      explorerUrl: outcome.explorerUrl,
      amount: outcome.amount,
    });
  });

  // Escrow fallback (config-gated): custodial credits, isolated from PayChan.
  if (deps.env.escrowEnabled) {
    app.post('/credits/escrow/deposit', async (request, reply) => {
      const parsed = EscrowDepositSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid deposit', issues: parsed.error.issues });
      }
      const result = await depositEscrow(deps, parsed.data);
      if (!result.ok) return reply.code(400).send({ error: result.reason });

      const { credit } = result;
      return reply.code(201).send({
        sellerId: credit.seller_id,
        walletAddress: credit.wallet_address,
        asset: credit.asset,
        creditsTotal: credit.credits_total,
        creditsUsed: credit.credits_used,
      });
    });
  }
}
