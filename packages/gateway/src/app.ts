/**
 * Fastify application factory. `buildApp` is the composition point for HTTP
 * concerns (CORS, health, routes); all external resources arrive via
 * {@link GatewayDeps} so the app itself owns no global state.
 */
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { registerAdminRoutes } from './routes/admin.route.js';
import { registerAuthRoutes } from './routes/auth.route.js';
import { registerBotRoutes } from './routes/bots.route.js';
import { registerSellerRoutes } from './routes/sellers.route.js';
import { registerChannelRoutes } from './routes/channels.route.js';
import { registerUsageRoutes } from './routes/usage.route.js';
import { registerFacilitatorRoutes } from './routes/facilitator.route.js';
import { recordRequestAudit } from './services/audit.service.js';
import type { GatewayDeps } from './deps.js';

export async function buildApp(deps: GatewayDeps): Promise<FastifyInstance> {
  // trustProxy: honor X-Forwarded-For only when explicitly configured, so
  // per-IP rate limits key on the real client behind a trusted reverse proxy.
  const app = Fastify({ logger: true, trustProxy: deps.env.trustProxy });

  await app.register(cors, { origin: deps.env.dashboardOrigin });

  // Global error handler: pass through client errors (validation, 4xx) with
  // their message, but never leak internal/DB error text on a 5xx — log the real
  // error and return a generic message. Without this, an unhandled throw (e.g. a
  // Postgres `invalid input syntax for type uuid` from a bad path param, or a
  // unique-constraint violation) would be echoed to the caller by Fastify.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      app.log.error(error);
      return reply.code(500).send({ error: 'internal server error' });
    }
    return reply.code(status).send({ error: error.message });
  });

  // Admin audit trail: capture every finished request (fire-and-forget insert,
  // so auditing can never slow or fail the request). Runs after the response is
  // sent; hijacked replies (the SSE stream) never reach onResponse and are not
  // audited.
  app.addHook('onResponse', (request, reply, done) => {
    recordRequestAudit(deps, request, reply);
    done();
  });

  app.get('/health', async () => ({ status: 'ok' }));

  registerAdminRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerBotRoutes(app, deps);
  registerSellerRoutes(app, deps);
  registerChannelRoutes(app, deps);
  registerUsageRoutes(app, deps);
  registerFacilitatorRoutes(app, deps);

  return app;
}
