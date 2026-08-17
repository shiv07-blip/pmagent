import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validation } from '@pma/core';
import { workerDb, tenants } from '@pma/db';
import { eq, sql } from 'drizzle-orm';
import { enqueueIngest, type IngestJobData } from '../queue.js';

const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    from: z.object({
      id: z.number(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      username: z.string().optional(),
    }),
    chat: z.object({
      id: z.number(),
    }),
    text: z.string().optional(),
    date: z.number(),
  }).optional(),
}).passthrough();

export async function registerTelegramRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/telegram', async (req, reply) => {
    const parsed = telegramUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw validation('Malformed Telegram update', parsed.error.issues);

    const update = parsed.data;
    if (!update.message || !update.message.text) {
      return reply.code(200).send({ ok: true });
    }

    const msg = update.message;
    const chatId = msg.chat.id;
    const from = msg.from;
    const text = msg.text;
    const senderRef = `tg:${from.id}`;

    const tenant = await resolveTelegramTenant();
    if (!tenant) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'No tenant configured for Telegram' });
    }

    const job: IngestJobData = {
      dedupeKey: `telegram:${chatId}:${msg.message_id}`,
      tenantId: tenant.id,
      channel: 'telegram',
      senderRef,
      body: text ?? '',
      mediaUrls: [],
      receivedAt: new Date(msg.date * 1000).toISOString(),
    };
    await enqueueIngest(app.queues.ingest, job);
    return reply.code(200).send({ ok: true });
  });
}

async function resolveTelegramTenant(): Promise<{ id: string } | null> {
  const db = workerDb();
  const rows = await db.execute(
    sql`select id from tenants where status = 'active' limit 1`,
  );
  const row = (rows.rows as Array<{ id: string }>)[0];
  return row ?? null;
}
