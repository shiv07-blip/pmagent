import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { AppError, forbidden, notFound } from '@pma/core';
import { workOrderEvents, workOrders } from '@pma/db';
import { tx } from '../auth.js';

const statusSchema = z.object({
  status: z.enum(['proposed', 'assigned', 'in_progress', 'completed', 'cancelled']),
  scheduledAt: z.string().datetime().optional(),
  actualCostCents: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

const approveSchema = z.object({
  estCostCents: z.number().int().min(0).optional(),
});

const TRANSITIONS: Record<string, string[]> = {
  proposed: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function registerWorkOrderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/work_orders', { preHandler: [app.authenticate] }, async (req) => {
    return tx(req, async (db) => ({
      work_orders: await db
        .select()
        .from(workOrders)
        .orderBy(desc(workOrders.createdAt)),
    }));
  });

  app.get('/work_orders/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string };
    return tx(req, async (db) => {
      const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, id));
      if (!wo) throw notFound('Work order not found');
      const events = await db
        .select()
        .from(workOrderEvents)
        .where(eq(workOrderEvents.workOrderId, id))
        .orderBy(workOrderEvents.createdAt);
      return { work_order: wo, events };
    });
  });

  app.patch(
    '/work_orders/:id/status',
    { preHandler: [app.authenticate, app.requireRole('admin')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = statusSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });

      return tx(req, async (db) => {
        const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, id));
        if (!wo) throw notFound('Work order not found');
        const allowed = TRANSITIONS[wo.status] ?? [];
        if (!allowed.includes(body.data.status)) {
          throw new AppError({
            code: 'VALIDATION',
            message: `Cannot transition ${wo.status} → ${body.data.status}`,
            httpStatus: 400,
          });
        }

        const set: Record<string, unknown> = {
          status: body.data.status,
          scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : wo.scheduledAt,
          actualCostCents: body.data.actualCostCents ?? wo.actualCostCents,
          notes: body.data.notes ?? wo.notes,
        };
        if (body.data.status === 'completed') set.completedAt = new Date();

        const [updated] = await db
          .update(workOrders)
          .set(set as never)
          .where(eq(workOrders.id, id))
          .returning();
        await db.insert(workOrderEvents).values({
          tenantId: req.ctx!.tenantId,
          workOrderId: id,
          eventType: `status.${body.data.status}`,
          actorType: 'agent',
          actorId: req.ctx!.userId,
          payload: { from: wo.status } as never,
        });

        app.pubsub.publish({
          tenantId: req.ctx!.tenantId,
          type: 'work_order.updated',
          data: { id, status: body.data.status },
          at: new Date().toISOString(),
        });
        return { work_order: updated };
      });
    },
  );

  /** Resolves the owner-approval gate on a proposed work order. */
  app.post(
    '/work_orders/:id/approve',
    { preHandler: [app.authenticate, app.requireRole('admin')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = approveSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });

      return tx(req, async (db) => {
        const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, id));
        if (!wo) throw notFound('Work order not found');
        if (wo.status !== 'proposed') throw forbidden('Only proposed work orders can be approved');

        const [updated] = await db
          .update(workOrders)
          .set({
            status: 'assigned',
            estCostCents: body.data.estCostCents ?? wo.estCostCents,
          })
          .where(eq(workOrders.id, id))
          .returning();
        await db.insert(workOrderEvents).values({
          tenantId: req.ctx!.tenantId,
          workOrderId: id,
          eventType: 'owner_approved',
          actorType: 'agent',
          actorId: req.ctx!.userId,
          payload: {} as never,
        });

        app.pubsub.publish({
          tenantId: req.ctx!.tenantId,
          type: 'work_order.updated',
          data: { id, status: 'assigned' },
          at: new Date().toISOString(),
        });
        return { work_order: updated };
      });
    },
  );
}
