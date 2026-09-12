import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createEmbedder, createProvider } from '@pma/agent';
import { loadRootEnv } from '@pma/core';
import { eq } from 'drizzle-orm';

/**
 * Full pipeline integration test (ingest -> agent -> notify). Requires real
 * Postgres + Redis (e.g. `docker compose up`):
 *   RUN_INTEGRATION=1 npm --workspace @pma/worker test
 *
 * Each run ingests from a unique resident phone number so a brand-new request
 * (and never a reused one) is created — the suite is idempotent across runs.
 */

const runIntegration = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!runIntegration)('pipeline integration', () => {
  let redis: Redis;
  let agentQueue: Queue;
  let notifyQueue: Queue;
  let publishCalled: unknown[] = [];
  const emit = (ev: unknown) => publishCalled.push(ev);

  beforeAll(async () => {
    loadRootEnv();
    const { initEnv } = await import('../src/env.js');
    const env = initEnv();
    const { migrate } = await import('@pma/db');
    await migrate();
    const { seed } = await import('@pma/db');
    await seed();

    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    agentQueue = new Queue('agent', { connection: redis });
    notifyQueue = new Queue('notify', { connection: redis });
    publishCalled = [];
  });

  afterAll(async () => {
    if (redis) {
      await agentQueue.close();
      await notifyQueue.close();
      await redis.quit();
    }
  });

  const freshPhone = (): string => `+1484${String(Math.floor(10000000 + Math.random() * 89999999))}`;

  const runPipeline = async (body: string, phone = freshPhone()) => {
    const { processIngest } = await import('../src/handlers/ingest.js');
    const { workerDb, tenants } = await import('@pma/db');
    const [t] = await workerDb().select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, 'acme-pm'));
    const tenant = t!.id;
    const dedupeKey = randomUUID();
    await processIngest(
      { tenantId: tenant, channel: 'sms', senderRef: phone, body, dedupeKey, mediaUrls: [], receivedAt: new Date().toISOString() },
      agentQueue,
      emit as never,
    );

    const jobs = await agentQueue.getJobs(['waiting', 'delayed', 'active', 'completed']);
    const job = jobs.find((j) => (j.name ?? j.id as string).endsWith(`:${dedupeKey}`));
    expect(job, 'ingest should have enqueued one agent job').toBeDefined();

    return { tenant, phone, requestId: (job!.data as { requestId: string }).requestId };
  };

  const runAgent = async (requestId: string) => {
    const { processAgent } = await import('../src/handlers/agent.js');
    const { ENV } = await import('../src/env.js');
    return processAgent({
      data: { requestId },
      provider: createProvider({ model: 'mock' }),
      embedder: createEmbedder({ provider: 'mock' }),
      notifyQueue,
      budgetLimitUsd: ENV!.LLM_TENANT_MONTHLY_BUDGET_USD,
      publish: emit as never,
    });
  };

  it('resolve_first_touch routes the AI reply through the notify queue (resident_sms)', async () => {
    const { workerDb, maintenanceRequests, requestMessages } = await import('@pma/db');

    const ctx = await runPipeline('Hi, I have a question about our mailbox');
    const outcome = await runAgent(ctx.requestId);
    expect(outcome.status).toBe('resolved');

    const [req] = await workerDb()
      .select()
      .from(maintenanceRequests)
      .where(eq(maintenanceRequests.id, ctx.requestId));
    expect(req!.status).toBe('completed');

    const outbound = await workerDb()
      .select()
      .from(requestMessages)
      .where(eq(requestMessages.requestId, ctx.requestId));
    expect(outbound.some((m) => m.direction === 'outbound')).toBe(true);

    const pending = await notifyQueue.getJobs(['waiting', 'delayed']);
    expect(pending.some((j) =>
      (j.data as { kind: string }).kind === 'resident_sms' &&
      (j.data as { payload: { to: string } }).payload.to === ctx.phone)).toBe(true);
  });

  it('creates a work order, auto-dispatches it, and enqueues vendor notifications', async () => {
    const { workerDb, maintenanceRequests, workOrders, requestAuditLog } = await import('@pma/db');

    const ctx = await runPipeline('Leaking pipe under the kitchen sink, please send a plumber.');
    const outcome = await runAgent(ctx.requestId);
    expect(outcome.status).toBe('work_order_created');

    const [req] = await workerDb()
      .select()
      .from(maintenanceRequests)
      .where(eq(maintenanceRequests.id, ctx.requestId));
    expect(req!.status).toBe('work_order_created');

    const [wo] = await workerDb()
      .select()
      .from(workOrders)
      .where(eq(workOrders.requestId, ctx.requestId));
    expect(wo).toBeDefined();
    expect(wo!.status).toBe('assigned');
    expect(wo!.dispatchToken).toMatch(/^[a-f0-9]{48}$/);
    expect(wo!.vendorResponse).toBe('pending');
    expect(wo!.dispatchedAt).toBeDefined();

    const audit = await workerDb()
      .select()
      .from(requestAuditLog)
      .where(eq(requestAuditLog.requestId, ctx.requestId));
    expect(audit.some((a) => a.action === 'vendor_dispatch')).toBe(true);

    const pending = await notifyQueue.getJobs(['waiting', 'delayed']);
    const kinds = pending.map((j) => (j.data as { kind: string }).kind);
    expect(kinds).toContain('vendor_sms');
    expect(kinds).toContain('vendor_email');
    const sms = pending.find((j) => (j.data as { kind: string }).kind === 'vendor_sms')!;
    const smsPayload = (sms.data as { payload: { to: string; body: string } }).payload;
    expect(smsPayload.to).toBe('+12175550101');
    expect(smsPayload.body).toContain('/webhooks/vendor/');
    expect(smsPayload.body).toContain('/accept');
  });

  it('notify jobs from the pipeline process without error', async () => {
    const { processNotify } = await import('../src/handlers/notify.js');
    const pending = await notifyQueue.getJobs(['waiting', 'delayed']);
    for (const job of pending) {
      await expect(processNotify(job.data as never)).resolves.toBeUndefined();
    }
  }, 20_000);
});