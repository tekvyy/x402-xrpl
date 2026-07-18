/**
 * Admin audit trail (request logging). Every gateway HTTP request is captured
 * by an app-level `onResponse` hook and written fire-and-forget: a slow or
 * failing audit insert must never delay or fail the request it describes.
 *
 * Redaction rules, enforced here and nowhere else:
 *  - query strings are stripped (the SSE route carries the session token there)
 *  - request/response bodies are never stored (payment payloads carry claim
 *    signatures)
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { insertAuditLog } from '../db/repositories.js';
import type { AuditLogCursor } from '../db/repositories.js';
import type { GatewayDeps } from '../deps.js';

/** User-agent values are capped so a hostile header cannot bloat rows. */
const MAX_USER_AGENT_LENGTH = 512;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Best-effort seller extraction so admins can filter the trail by seller.
 * Routes reference sellers as `sellerId` in the query (usage reads), the body
 * (verify/challenge/bot creation), or as the `:id` param on seller routes.
 * The value is validated as a UUID before use — the column is typed `uuid` and
 * a garbage value must not make the insert throw.
 */
function extractSellerId(request: FastifyRequest): string | null {
  const candidates: unknown[] = [];
  const { query, body, params } = request as {
    query?: Record<string, unknown>;
    body?: unknown;
    params?: Record<string, unknown>;
  };
  if (query && typeof query === 'object') candidates.push(query['sellerId']);
  if (body && typeof body === 'object') {
    candidates.push((body as Record<string, unknown>)['sellerId']);
  }
  if (request.routeOptions.url?.startsWith('/sellers/') && params && typeof params === 'object') {
    candidates.push(params['id']);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && UUID_PATTERN.test(candidate)) return candidate;
  }
  return null;
}

/** Whether a request is audit-worthy; health checks and CORS preflights are noise. */
function shouldAudit(request: FastifyRequest): boolean {
  if (request.method === 'OPTIONS') return false;
  const path = request.url.split('?')[0]!;
  return path !== '/health';
}

/**
 * Capture one finished request into the audit trail. Fire-and-forget: errors
 * are logged and swallowed so auditing can never break request handling.
 */
export function recordRequestAudit(
  deps: GatewayDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (!shouldAudit(request)) return;
  const userAgent = request.headers['user-agent'];
  void insertAuditLog(deps.pool, {
    requestId: String(request.id),
    method: request.method,
    route: request.routeOptions.url ?? null,
    path: request.url.split('?')[0]!,
    statusCode: reply.statusCode,
    durationMs: Math.round(reply.elapsedTime),
    actorAddress: request.ownerAddress ?? null,
    sellerId: extractSellerId(request),
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
  }).catch((err) => {
    request.log.error({ err }, 'audit log insert failed');
  });
}

/**
 * Opaque keyset cursor for audit pages: base64 of `<createdAtISO>|<id>`.
 * Encoded so clients treat it as a token rather than reaching into its parts.
 */
export function encodeAuditCursor(cursor: AuditLogCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

/** Decode a client-supplied cursor; null when malformed (caller replies 400). */
export function decodeAuditCursor(token: string): AuditLogCursor | null {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf('|');
  if (separator === -1) return null;
  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !UUID_PATTERN.test(id)) return null;
  return { createdAt, id };
}
