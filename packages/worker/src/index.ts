import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createProvider } from '@pma/agent';
import { loadRootEnv } from '@pma/core';
import { initEnv, ENV } from './env.js';
import { processAgent } from './handlers/agent.js';
import { processIngest } from './handlers/ingest.js';
import { processNotify } from './handlers/notify.js';
import { checkSlaBreaches } from './handlers/sla.js';
import { createPublisher } from './pubsub.js';

loadRootEnv();

async function main(): Promise<void> {
  initEnv();
  const connection = new Redis(ENV.REDIS_URL, { maxRetriesPerRequest: null });
  const publisher = createPublisher(ENV.REDIS_URL);
  const emit = (ev: Parameters<typeof publisher.publish>[0]) => publisher.publish(ev);
  const provider = createProvider({ model: ENV.LLM_MODEL });

  const agentQueue = new Queue('agent', { connection });
  const notifyQueue = new Queue('notify', { connection });

  const ingestWorker = new Worker(
    'ingest',
    async (job) => {
      await processIngest(job.data, agentQueue, emit);
    },
    { connection, concurrency: 4 },
  );

  const agentWorker = new Worker(
    'agent',
    async (job) => {
      await processAgent({
        data: job.data,
        provider,
        notifyQueue,
        budgetLimitUsd: ENV.LLM_TENANT_MONTHLY_BUDGET_USD,
        publish: emit,
      });
    },
    { connection, concurrency: ENV.AGENT_CONCURRENCY },
  );

  const notifyWorker = new Worker(
    'notify',
    async (job) => {
      await processNotify(job.data);
    },
    { connection, concurrency: 4 },
  );

  for (const [name, w] of [
    ['ingest', ingestWorker],
    ['agent', agentWorker],
    ['notify', notifyWorker],
  ] as const) {
    w.on('failed', (job, err) => {
      console.error(`[pma-worker] ${name} job failed`, job?.id, err.message);
    });
  }

  const shutdown = async () => {
    clearInterval(slaTimer);
    console.log('[pma-worker] shutting down');
    await Promise.allSettled([
      ingestWorker.close(),
      agentWorker.close(),
      notifyWorker.close(),
      agentQueue.close(),
      notifyQueue.close(),
      publisher.close(),
      connection.quit(),
    ]);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[pma-worker] listening (provider=${provider.providerName}, model=${provider.model})`);

  const slaCheck = async () => {
    try {
      const db = (await import('@pma/db')).workerDb();
      const { tenants: tenantsTable, maintenanceRequests } = await import('@pma/db');
      const { eq } = await import('drizzle-orm');
      const tenantRows = await db.select().from(tenantsTable).where(eq(tenantsTable.status, 'active'));

      for (const t of tenantRows) {
        const config = t.config as Record<string, unknown>;
        const ackSlaMinutes = (config.ackSlaMinutes as number) ?? 60;

        const escalate = async (requestId: string, reason: string) => {
          await db.update(maintenanceRequests).set({ status: 'escalated' }).where(eq(maintenanceRequests.id, requestId));
          await notifyQueue.add(
            `sla_breach_${requestId}`,
            { tenantId: t.id, kind: 'pm_alert', payload: { message: reason } },
            { removeOnComplete: 1000, removeOnFail: 1000 },
          );
          emit({ tenantId: t.id, type: 'request.sla_breach', data: { requestId, reason }, at: new Date().toISOString() });
        };

        const breached = await checkSlaBreaches(t.id, ackSlaMinutes, escalate);
        if (breached > 0) console.log(`[sla] tenant ${t.id.slice(0, 8)}: ${breached} SLA breach(es)`);
      }
    } catch (err) {
      console.error('[sla] check failed', err);
    }
  };

  const slaTimer = setInterval(slaCheck, 5 * 60 * 1000);
  slaCheck();
}

main().catch((err) => {
  console.error('[pma-worker] fatal startup error', err);
  process.exit(1);
});
