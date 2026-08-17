import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { notFound } from '@pma/core';
import { tenants } from '@pma/db';
import { tx } from '../auth.js';

const configSchema = z.object({
  ownerApprovalThresholdUsd: z.number().min(0).optional(),
  supportedTrades: z.array(z.string()).optional(),
  preferredVendorIds: z.array(z.string()).optional(),
  ackSlaMinutes: z.number().min(1).max(1440).optional(),
  channels: z
    .array(
      z.object({
        channel: z.enum(['sms', 'email', 'portal', 'voice']),
        from: z.string(),
        enabled: z.boolean(),
      }),
    )
    .optional(),
  emergencyKeywords: z.array(z.string()).optional(),
});

export async function registerTenantRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tenants', { preHandler: [app.authenticate] }, async (req) => {
    return { tenants: req.ctx!.memberships };
  });

  app.get('/tenants/current', { preHandler: [app.authenticate] }, async (req) => {
    return tx(req, async (db) => {
      const [t] = await db.select().from(tenants).where(eq(tenants.id, req.ctx!.tenantId));
      if (!t) throw notFound('Tenant not found');
      return { tenant: t };
    });
  });

  app.put(
    '/tenants/current/config',
    { preHandler: [app.authenticate, app.requireRole('admin')] },
    async (req, reply) => {
      const body = configSchema.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
      }
      return tx(req, async (db) => {
        const [t] = await db
          .select({ config: tenants.config })
          .from(tenants)
          .where(eq(tenants.id, req.ctx!.tenantId));
        if (!t) throw notFound('Tenant not found');
        const merged = { ...(t.config as Record<string, unknown>), ...body.data };
        const [updated] = await db
          .update(tenants)
          .set({ config: merged as never })
          .where(eq(tenants.id, req.ctx!.tenantId))
          .returning();
        return { tenant: updated };
      });
    },
  );
}
