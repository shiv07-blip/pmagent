import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { validation } from '@pma/core';
import { workerDb } from '@pma/db';
import { createQueues, enqueueIngest, type IngestJobData } from '../queue.js';

const smsSchema = z.object({
  MessageSid: z.string(),
  From: z.string().min(1),
  To: z.string().min(1),
  Body: z.string().min(1).max(4000),
  MediaUrl0: z.string().optional(),
});

const emailSchema = z.object({
  MessageId: z.string(),
  From: z.string().email(),
  To: z.string().min(1),
  Subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
});

const portalSchema = z.object({
  messageId: z.string().optional(),
  tenantId: z.string().uuid(),
  residentId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  subject: z.string().optional(),
  body: z.string().min(1).max(4000),
});

const msg91Schema = z.object({
  number: z.string().min(1),
  message: z.string().min(1).max(4000),
  keyword: z.string().optional(),
  sender: z.string().optional(),
});

const msg91JsonSchema = z.object({
  customerNumber: z.string().min(1),
  text: z.string().min(1).max(4000),
  integratedNumber: z.string().optional(),
  requestId: z.string().optional(),
});

interface ChannelRow {
  id: string;
  config: Record<string, unknown>;
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  const db = workerDb();

  app.post('/webhooks/sms', async (req, reply) => {
    const body = smsSchema.safeParse(req.body);
    if (!body.success) throw validation('Malformed SMS webhook', body.error.issues);

    const tenant = await resolveTenantByChannel(db, 'sms', body.data.To);
    if (!tenant) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unassigned inbound number' });
    }

    const job: IngestJobData = {
      dedupeKey: `sms:${body.data.MessageSid}`,
      tenantId: tenant.id,
      channel: 'sms',
      senderRef: normalizePhone(body.data.From),
      subject: undefined,
      body: body.data.Body,
      mediaUrls: body.data.MediaUrl0 ? [body.data.MediaUrl0] : [],
      receivedAt: new Date().toISOString(),
    };
    await enqueueIngest(app.queues.ingest, job);
    return reply.code(202).send({ accepted: true, jobId: job.dedupeKey });
  });

  app.post('/webhooks/email', async (req, reply) => {
    const body = emailSchema.safeParse(req.body);
    if (!body.success) throw validation('Malformed email webhook', body.error.issues);
    const fromAddr = body.data.From.toLowerCase();
    const toAddr = body.data.To.toLowerCase();

    const tenant = await resolveTenantByChannel(db, 'email', toAddr);
    if (!tenant) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unassigned inbound inbox' });
    }

    const job: IngestJobData = {
      dedupeKey: `email:${body.data.MessageId}`,
      tenantId: tenant.id,
      channel: 'email',
      senderRef: fromAddr,
      subject: body.data.Subject,
      body: body.data.text ?? body.data.html ?? '',
      mediaUrls: [],
      receivedAt: new Date().toISOString(),
    };
    await enqueueIngest(app.queues.ingest, job);
    return reply.code(202).send({ accepted: true, jobId: job.dedupeKey });
  });

  app.post('/webhooks/portal', async (req, reply) => {
    const body = portalSchema.safeParse(req.body);
    if (!body.success) throw validation('Malformed portal webhook', body.error.issues);

    const job: IngestJobData = {
      dedupeKey: body.data.messageId ?? `portal:${crypto.randomUUID()}`,
      tenantId: body.data.tenantId,
      channel: 'portal',
      senderRef: body.data.residentId ?? 'portal-anon',
      unitId: body.data.unitId,
      residentId: body.data.residentId,
      subject: body.data.subject,
      body: body.data.body,
      mediaUrls: [],
      receivedAt: new Date().toISOString(),
    };
    await enqueueIngest(app.queues.ingest, job);
    return reply.code(202).send({ accepted: true, jobId: job.dedupeKey });
  });

  app.post('/webhooks/msg91', async (req, reply) => {
    const body = msg91Schema.safeParse(req.body);
    if (!body.success) throw validation('Malformed MSG91 webhook', body.error.issues);

    let tenant = null;
    if (body.data.sender) {
      tenant = await resolveTenantByChannel(db, 'sms', normalizePhone(body.data.sender));
    }
    if (!tenant) {
      tenant = await resolveAnySmsTenant(db);
    }
    if (!tenant) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unassigned MSG91 number' });
    }

    const job: IngestJobData = {
      dedupeKey: `msg91:${body.data.number}:${Date.now()}`,
      tenantId: tenant.id,
      channel: 'sms',
      senderRef: normalizePhone(body.data.number),
      subject: undefined,
      body: body.data.message,
      mediaUrls: [],
      receivedAt: new Date().toISOString(),
    };
    await enqueueIngest(app.queues.ingest, job);
    return reply.code(202).send({ accepted: true, jobId: job.dedupeKey });
  });

  app.post('/webhooks/msg91/json', async (req, reply) => {
    const body = msg91JsonSchema.safeParse(req.body);
    if (!body.success) throw validation('Malformed MSG91 JSON webhook', body.error.issues);

    const toNumber = body.data.integratedNumber ? normalizePhone(body.data.integratedNumber) : 'unknown';
    const tenant = await resolveTenantByChannel(db, 'sms', toNumber);
    if (!tenant) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unassigned MSG91 number' });
    }

    const job: IngestJobData = {
      dedupeKey: `msg91:${body.data.requestId ?? crypto.randomUUID()}`,
      tenantId: tenant.id,
      channel: 'sms',
      senderRef: normalizePhone(body.data.customerNumber),
      subject: undefined,
      body: body.data.text,
      mediaUrls: [],
      receivedAt: new Date().toISOString(),
    };
    await enqueueIngest(app.queues.ingest, job);
    return reply.code(202).send({ accepted: true, jobId: job.dedupeKey });
  });
}

async function resolveTenantByChannel(
  db: ReturnType<typeof workerDb>,
  channel: string,
  from: string,
): Promise<ChannelRow | null> {
  const match = JSON.stringify([{ from, channel, enabled: true }]);
  const rows = await db.execute(
    sql`select id, config from tenants where status = 'active' and (config->'channels') @> ${match}::jsonb limit 1`,
  );
  const row = (rows.rows as Array<{ id: string; config: Record<string, unknown> }>)[0];
  return row ?? null;
}

async function resolveAnySmsTenant(
  db: ReturnType<typeof workerDb>,
): Promise<ChannelRow | null> {
  const rows = await db.execute(
    sql`select id, config from tenants where status = 'active' and (config->'channels') @> ${JSON.stringify([{ channel: 'sms', enabled: true }])}::jsonb limit 1`,
  );
  const row = (rows.rows as Array<{ id: string; config: Record<string, unknown> }>)[0];
  return row ?? null;
}

function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+1${digits}`;
}
