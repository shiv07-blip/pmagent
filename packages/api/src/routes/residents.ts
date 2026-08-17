import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { notFound } from '@pma/core';
import { leases, residents } from '@pma/db';
import { tx } from '../auth.js';

const residentSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  language: z.string().default('en'),
});

const leaseSchema = z.object({
  unitId: z.string().uuid(),
  residentId: z.string().uuid(),
  start: z.string(),
  end: z.string(),
  status: z.enum(['active', 'expired', 'pending']).default('active'),
  terms: z.record(z.unknown()).optional(),
});

export async function registerResidentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/residents', { preHandler: [app.authenticate] }, async (req) => {
    return tx(req, async (db) => ({ residents: await db.select().from(residents) }));
  });

  app.post('/residents', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const body = residentSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const [row] = await db.insert(residents).values({ tenantId: req.ctx!.tenantId, ...body.data }).returning();
      return { resident: row };
    });
  });

  app.get('/residents/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string };
    return tx(req, async (db) => {
      const [r] = await db.select().from(residents).where(eq(residents.id, id));
      if (!r) throw notFound('Resident not found');
      const residentLeases = await db.select().from(leases).where(eq(leases.residentId, id));
      return { resident: r, leases: residentLeases };
    });
  });

  app.post('/leases', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const body = leaseSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const [row] = await db
        .insert(leases)
        .values({
          tenantId: req.ctx!.tenantId,
          unitId: body.data.unitId,
          residentId: body.data.residentId,
          startDate: new Date(body.data.start),
          endDate: new Date(body.data.end),
          status: body.data.status as never,
          terms: body.data.terms as never,
        })
        .returning();
      return { lease: row };
    });
  });

  app.patch('/leases/:id', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = leaseSchema.partial().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const set: Record<string, unknown> = {};
      if (body.data.start) set.startDate = new Date(body.data.start);
      if (body.data.end) set.endDate = new Date(body.data.end);
      if (body.data.status) set.status = body.data.status as never;
      if (body.data.terms) set.terms = body.data.terms as never;
      if (body.data.unitId) set.unitId = body.data.unitId;
      if (body.data.residentId) set.residentId = body.data.residentId;
      const [row] = await db
        .update(leases)
        .set(set as never)
        .where(eq(leases.id, id))
        .returning();
      if (!row) throw notFound('Lease not found');
      return { lease: row };
    });
  });
}
