import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function start(name, script) {
  const child = fork(join(__dirname, script), { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.error(`[${name}] exited with code ${code}`);
    process.exit(code ?? 1);
  });
  return child;
}

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
