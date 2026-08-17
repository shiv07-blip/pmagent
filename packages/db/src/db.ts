import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, PoolClient } from 'pg';
import * as schema from './schema.js';

export type { Pool, PoolClient };

let _apiPool: Pool | undefined;
let _workerPool: Pool | undefined;

export function apiPool(): Pool {
  if (!_apiPool) {
    _apiPool = new Pool({
      connectionString: process.env.API_DATABASE_URL,
      max: Number(process.env.API_DB_POOL_MAX ?? 20),
      idleTimeoutMillis: 30_000,
    });
    _apiPool.on('error', (err) => {
      console.error('[db:api] idle client error', err.message);
    });
  }
  return _apiPool;
}

export function workerPool(): Pool {
  if (!_workerPool) {
    _workerPool = new Pool({
      connectionString: process.env.WORKER_DATABASE_URL,
      max: Number(process.env.WORKER_DB_POOL_MAX ?? 20),
      idleTimeoutMillis: 30_000,
    });
    _workerPool.on('error', (err) => {
      console.error('[db:worker] idle client error', err.message);
    });
  }
  return _workerPool;
}

export type Db = NodePgDatabase<typeof schema>;
export const tables = schema;

/**
 * Runs `fn` inside a single transaction with RLS tenant context set via
 * transaction-local settings. Safe under pgbouncer transaction pooling: the
 * settings are LOCAL, so they die with the transaction, and the connection is
 * released clean.
 */
export async function withTenant<T>(
  tenantId: string,
  userId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const pool = apiPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    const db = drizzle(client, { schema });
    const result = await fn(db);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Worker-side (service role, BYPASSRLS). Callers must scope by tenant_id. */
export const workerDb = (): Db => drizzle(workerPool(), { schema });

/** Low-level client access for one-off bootstrap (e.g. seeding). */
export async function withServiceClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = workerPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function ping(): Promise<void> {
  await apiPool().query('SELECT 1');
  await workerPool().query('SELECT 1');
}
