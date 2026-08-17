import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { notFound } from '@pma/core';
import { maintenanceRequests, requestMessages } from '@pma/db';
import { tx } from '../auth.js';

const listQuery = z.object({
  status: z.string().optional(),
  unitId: z.string().uuid().optional(),
  residentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const closeSchema = z.object({
  resolution: z.string().min(1).optional(),
});

const outboundSchema = z.object({
  body: z.string().min(1).max(4000),
  channel: z.enum(['sms', 'email', 'portal', 'voice']).default('portal'),
});

export async function registerRequestRoutes(app: FastifyInstance): Promise<void> {
  app.get('/requests', { preHandler: [app.authenticate] }, async (req, reply) => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'VALIDATION', issues: q.error.issues });
    const { status, unitId, residentId, limit, offset } = q.data;

    return tx(req, async (db) => {
      const conds = [];
      if (status) conds.push(eq(maintenanceRequests.status, status as never));
      if (unitId) conds.push(eq(maintenanceRequests.unitId, unitId));
      if (residentId) conds.push(eq(maintenanceRequests.residentId, residentId));
      const where = conds.length ? and(...conds) : undefined;

      const rows = await db
        .select()
        .from(maintenanceRequests)
        .where(where)
        .orderBy(desc(maintenanceRequests.createdAt))
        .limit(limit)
        .offset(offset);
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(maintenanceRequests)
        .where(where);
      return { requests: rows, total: count?.n ?? 0 };
    });
  });

  app.get('/requests/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string };
    return tx(req, async (db) => {
      const [r] = await db
        .select()
        .from(maintenanceRequests)
        .where(eq(maintenanceRequests.id, id));
      if (!r) throw notFound('Request not found');
      const messages = await db
        .select()
        .from(requestMessages)
        .where(eq(requestMessages.requestId, id))
        .orderBy(requestMessages.createdAt);
      return { request: r, messages };
    });
  });

  app.post('/requests/:id/close', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = closeSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const [r] = await db
        .update(maintenanceRequests)
        .set({ status: 'closed', closedAt: new Date() })
        .where(eq(maintenanceRequests.id, id))
        .returning();
      if (!r) throw notFound('Request not found');
      app.pubsub.publish({
        tenantId: req.ctx!.tenantId,
        type: 'request.updated',
        data: { id, status: 'closed' },
        at: new Date().toISOString(),
      });
      return { request: r };
    });
  });

  app.get('/requests/:id/messages', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string };
    return tx(req, async (db) => {
      const messages = await db
        .select()
        .from(requestMessages)
        .where(eq(requestMessages.requestId, id))
        .orderBy(requestMessages.createdAt);
      return { messages };
    });
  });

  app.post(
    '/requests/:id/messages',
    { preHandler: [app.authenticate, app.requireRole('admin')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = outboundSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });

      return tx(req, async (db) => {
        const [r] = await db
          .select({ id: maintenanceRequests.id })
          .from(maintenanceRequests)
          .where(eq(maintenanceRequests.id, id));
        if (!r) throw notFound('Request not found');

        const [msg] = await db
          .insert(requestMessages)
          .values({
            tenantId: req.ctx!.tenantId,
            requestId: id,
            direction: 'outbound',
            channel: body.data.channel,
            body: body.data.body,
            senderType: 'agent',
            senderId: req.ctx!.userId,
          })
          .returning();

        app.pubsub.publish({
          tenantId: req.ctx!.tenantId,
          type: 'message.created',
          data: { requestId: id, message: msg },
          at: new Date().toISOString(),
        });
        return { message: msg };
      });
    },
  );
}
