-- Up Migration

-- One row per gateway HTTP request, written fire-and-forget from the app-level
-- onResponse hook (audit.service.ts). Powers the admin audit trail. Query
-- strings and request bodies are never stored: session tokens ride in a query
-- param on the SSE route and payment payloads carry claim signatures.
CREATE TABLE audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Fastify per-request id, for correlating with process logs.
  request_id     TEXT NOT NULL,
  method         TEXT NOT NULL,
  -- Matched route pattern (e.g. /sellers/:id); null when no route matched.
  route          TEXT,
  -- Actual request path with the query string stripped.
  path           TEXT NOT NULL,
  status_code    INT NOT NULL,
  duration_ms    INT NOT NULL,
  -- Authenticated caller's XRPL address; null for anonymous requests.
  actor_address  TEXT,
  -- Seller the request concerned, when resolvable. Not a foreign key: audit
  -- rows must survive seller deletion and never block a request path.
  seller_id      UUID,
  ip             TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Composite (created_at, id) matches the keyset-pagination ORDER BY; the rest
-- cover each admin filter combined with the time ordering.
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC, id DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_address, created_at DESC);
CREATE INDEX audit_logs_route_idx ON audit_logs (route, created_at DESC);
CREATE INDEX audit_logs_status_idx ON audit_logs (status_code, created_at DESC);
CREATE INDEX audit_logs_seller_idx ON audit_logs (seller_id, created_at DESC);
CREATE INDEX audit_logs_request_id_idx ON audit_logs (request_id);

-- Down Migration

DROP TABLE IF EXISTS audit_logs;
