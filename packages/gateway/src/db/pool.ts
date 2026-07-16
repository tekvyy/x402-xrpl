/**
 * Postgres connection pool factory. A single pool is shared across the
 * gateway; repositories receive it (or a checked-out client for transactions)
 * as an explicit dependency rather than reaching for a global.
 */
import pg from 'pg';
import type { Pool } from 'pg';

const { Pool: PgPool } = pg;

/** Anything able to run a parameterized query — the pool or a pooled client. */
export type Queryable = Pick<Pool, 'query'>;

/** Create a Postgres pool from a connection string. */
export function createPool(connectionString: string): Pool {
  const pool = new PgPool({ connectionString });
  // node-postgres emits `error` on idle clients (DB restart, network blip). An
  // unhandled EventEmitter `error` would crash the whole gateway — log instead.
  pool.on('error', (err) => {
    console.error('[db] idle client error', err);
  });
  return pool;
}
