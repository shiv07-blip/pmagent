import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { notFound } from '@pma/core';
import { properties, units } from '@pma/db';
import { tx } from '../auth.js';

const propertySchema = z.object({
  name: z.string().min(1),
  address: z.record(z.unknown()),
  timezone: z.string().default('America/New_York'),
});

const unitSchema = z.object({
  propertyId: z.string().uuid(),
  unitNumber: z.string().min(1),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  monthlyRentCents: z.number().int().min(0).optional(),
  status: z.enum(['occupied', 'vacant', 'make_ready']).optional(),
});

export async function registerPropertyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/properties', { preHandler: [app.authenticate] }, async (req) => {
    return tx(req, async (db) => {
      const rows = await db.select().from(properties);
      return { properties: rows };
    });
  });

  app.post('/properties', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const body = propertySchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const [row] = await db
        .insert(properties)
        .values({ tenantId: req.ctx!.tenantId, ...body.data, address: body.data.address as never })
        .returning();
      return { property: row };
    });
  });

  app.patch('/properties/:id', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = propertySchema.partial().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const [row] = await db
        .update(properties)
        .set({ ...body.data, address: body.data.address as never })
        .where(eq(properties.id, id))
        .returning();
      if (!row) throw notFound('Property not found');
      return { property: row };
    });
  });

  app.get('/units', { preHandler: [app.authenticate] }, async (req) => {
    const { propertyId } = req.query as { propertyId?: string };
    return tx(req, async (db) => {
      const rows = propertyId
        ? await db.select().from(units).where(eq(units.propertyId, propertyId))
        : await db.select().from(units);
      return { units: rows };
    });
  });

  app.post('/units', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const body = unitSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const [row] = await db.insert(units).values({ tenantId: req.ctx!.tenantId, ...body.data }).returning();
      return { unit: row };
    });
  });

  app.patch('/units/:id', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = unitSchema.partial().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const [row] = await db
        .update(units)
        .set(body.data)
        .where(and(eq(units.id, id)))
        .returning();
      if (!row) throw notFound('Unit not found');
      return { unit: row };
    });
  });
}
