import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { notFound } from '@pma/core';
import { vendors } from '@pma/db';
import { tx } from '../auth.js';

const vendorSchema = z.object({
  name: z.string().min(1),
  trades: z.array(z.string()).min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  serviceAreas: z.record(z.unknown()).optional(),
  hourlyRateCents: z.number().int().optional(),
  emergencyCapable: z.boolean().default(false),
  isPreferred: z.boolean().default(false),
});

export async function registerVendorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/vendors', { preHandler: [app.authenticate] }, async (req) => {
    return tx(req, async (db) => ({ vendors: await db.select().from(vendors) }));
  });

  app.post('/vendors', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const body = vendorSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const [row] = await db
        .insert(vendors)
        .values({
          tenantId: req.ctx!.tenantId,
          ...body.data,
          serviceAreas: body.data.serviceAreas as never,
          trades: body.data.trades as never,
        })
        .returning();
      return { vendor: row };
    });
  });

  app.patch('/vendors/:id', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = vendorSchema.partial().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    return tx(req, async (db) => {
      const [row] = await db
        .update(vendors)
        .set({ ...body.data, serviceAreas: body.data.serviceAreas as never, trades: body.data.trades as never })
        .where(eq(vendors.id, id))
        .returning();
      if (!row) throw notFound('Vendor not found');
      return { vendor: row };
    });
  });
}
