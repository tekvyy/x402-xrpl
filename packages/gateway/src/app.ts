/**
 * Fastify application factory. `buildApp` is the composition point for HTTP
 * concerns (CORS, health, routes); all external resources arrive via
 * {@link GatewayDeps} so the app itself owns no global state.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerSellerRoutes } from './routes/sellers.route.js';
import { registerProxyRoutes } from './routes/proxy.route.js';
import type { GatewayDeps } from './deps.js';

export async function buildApp(deps: GatewayDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: deps.env.dashboardOrigin });

  app.get('/health', async () => ({ status: 'ok' }));

  registerSellerRoutes(app, deps);
  registerProxyRoutes(app, deps);

  return app;
}
