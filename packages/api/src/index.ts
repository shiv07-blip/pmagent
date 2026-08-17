import { loadRootEnv } from '@pma/core';
import { buildApp } from './app.js';
import { initEnv } from './env.js';
import { PubSub } from './pubsub.js';
import { createQueues } from './queue.js';

loadRootEnv();

async function main(): Promise<void> {
  const env = initEnv();
  const pubsub = new PubSub(env.REDIS_URL);
  await pubsub.start();
  const queues = createQueues(env.REDIS_URL);
  const app = await buildApp({ pubsub, queues });

  const close = async () => {
    await app.close();
    await queues.close();
    await pubsub.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
}

main().catch((err) => {
  console.error('[pma-api] fatal startup error', err);
  process.exit(1);
});
