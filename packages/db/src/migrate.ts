import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { loadRootEnv } from '@pma/core';

loadRootEnv();

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

async function ensureMigrationTable(client: import('pg').PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function migrate(): Promise<void> {
  const connectionString =
    process.env.MIGRATE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.API_DATABASE_URL;
  if (!connectionString) throw new Error('MIGRATE_DATABASE_URL / DATABASE_URL not set');

  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await ensureMigrationTable(client);
    const applied = new Set(
      (await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map(
        (r) => r.id,
      ),
    );

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed: ${file}`, { cause: err });
      }
    }
    console.log('[migrate] done');
  } finally {
    client.release();
    await pool.end();
  }
}

// Allow running directly: npm run migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
