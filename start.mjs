import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Upstash Redis requires TLS — auto-upgrade redis:// to rediss://
if (process.env.REDIS_URL && process.env.REDIS_URL.startsWith('redis://') && process.env.REDIS_URL.includes('upstash')) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace('redis://', 'rediss://');
  console.log('[start] upgraded REDIS_URL to rediss:// for Upstash TLS');
}

async function runMigrations() {
  console.log('[start] running database migrations...');
  try {
    const { migrate } = await import('./packages/db/dist/migrate.js');
    await migrate();
    console.log('[start] migrations complete');
  } catch (err) {
    console.error('[start] migration failed:', err.message);
  }
}

async function seed() {
  console.log('[start] seeding database...');
  try {
    const { seed: runSeed } = await import('./packages/db/dist/seed.js');
    await runSeed();
    console.log('[start] seed complete');
  } catch (err) {
    console.error('[start] seed failed (may already exist):', err.message);
  }
}

function start(name, script) {
  const child = fork(join(__dirname, script), { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.error(`[${name}] exited with code ${code}`);
    process.exit(code ?? 1);
  });
  return child;
}

await runMigrations();
await seed();

const api = start('api', 'packages/api/dist/index.js');
const worker = start('worker', 'packages/worker/dist/index.js');

const shutdown = () => {
  console.log('[start] shutting down');
  api.kill('SIGTERM');
  worker.kill('SIGTERM');
  setTimeout(() => process.exit(0), 10000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
