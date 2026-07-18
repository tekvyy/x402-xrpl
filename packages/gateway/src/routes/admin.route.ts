/**
 * Admin-only audit-trail routes.
 *
 *   GET /admin/audit-logs → filterable, keyset-paginated request log
 *
 * Access requires an ordinary wallet session whose address is listed in
 * `ADMIN_ADDRESSES`; everyone else gets 403.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryAuditLogs } from '../db/repositories.js';
import type { AuditLogFilters } from '../db/repositories.js';
import type { AuditLogRow } from '../db/types.js';
import { decodeAuditCursor, encodeAuditCursor } from '../services/audit.service.js';
import { requireAdmin } from './authenticate.js';
import { AUDIT_LOG_DEFAULT_PAGE_SIZE, AUDIT_LOG_MAX_PAGE_SIZE } from '../constants.js';
import type { GatewayDeps } from '../deps.js';

const AuditLogQuerySchema = z.object({
  /** Inclusive time bounds (ISO 8601). */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  method: z
    .string()
    .regex(/^[A-Za-z]+$/)
    .transform((value) => value.toUpperCase())
    .optional(),
  /** Exact matched-route pattern, e.g. `/sellers/:id`. */
  route: z.string().min(1).max(200).optional(),
  /** Prefix match on the concrete request path. */
  pathPrefix: z.string().min(1).max(200).optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  statusMin: z.coerce.number().int().min(100).max(599).optional(),
  statusMax: z.coerce.number().int().min(100).max(599).optional(),
  actor: z.string().min(1).max(64).optional(),
  sellerId: z.string().uuid().optional(),
  requestId: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_LOG_MAX_PAGE_SIZE).optional(),
  cursor: z.string().min(1).optional(),
});

/** Camel-cased wire projection of an audit row. */
function toWire(row: AuditLogRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    method: row.method,
    route: row.route,
    path: row.path,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    actorAddress: row.actor_address,
    sellerId: row.seller_id,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

export function registerAdminRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const admin = requireAdmin(deps);

  app.get('/admin/audit-logs', { preHandler: admin }, async (request, reply) => {
    const parsed = AuditLogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid audit-log query', issues: parsed.error.issues });
    }
    const query = parsed.data;

    const cursor = query.cursor ? decodeAuditCursor(query.cursor) : undefined;
    if (query.cursor && !cursor) {
      return reply.code(400).send({ error: 'invalid cursor' });
    }

    const filters: AuditLogFilters = {
      from: query.from,
      to: query.to,
      method: query.method,
      route: query.route,
      pathPrefix: query.pathPrefix,
      status: query.status,
      statusMin: query.statusMin,
      statusMax: query.statusMax,
      actorAddress: query.actor,
      sellerId: query.sellerId,
      requestId: query.requestId,
    };
    const limit = query.limit ?? AUDIT_LOG_DEFAULT_PAGE_SIZE;

    const rows = await queryAuditLogs(deps.pool, filters, limit, cursor ?? undefined);
    const last = rows[rows.length - 1];
    // A full page means there may be older rows; hand back a cursor to continue.
    const nextCursor =
      rows.length === limit && last
        ? encodeAuditCursor({ createdAt: last.created_at, id: last.id })
        : null;

    return reply.send({ logs: rows.map(toWire), nextCursor });
  });
}
