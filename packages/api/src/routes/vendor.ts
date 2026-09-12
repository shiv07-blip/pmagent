import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { requestAuditLog, workerDb, workOrderEvents, workOrders } from '@pma/db';

/**
 * Token-scoped dispatch links shared with vendors via SMS/email:
 *   GET /webhooks/vendor/:token/accept
 *   GET /webhooks/vendor/:token/decline
 * The token IS the credential — no headers possible from a link tap, so no
 * HMAC here. Defaults the work order status accordingly.
 */
export async function registerVendorWebhookRoutes(app: FastifyInstance): Promise<void> {
  for (const action of ['accept', 'decline'] as const) {
    app.get(`/webhooks/vendor/:token/${action}`, async (req, reply) => {
      const { token } = req.params as { token: string };
      if (!token || !/^[a-f0-9]{48}$/.test(token)) {
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      }

      const db = workerDb();
      const [wo] = await db
        .select()
        .from(workOrders)
        .where(eq(workOrders.dispatchToken, token));
      if (!wo) {
        return reply.code(404).type('text/html').send('<h1>Not found</h1>');
      }
      if (wo.vendorResponse !== 'pending') {
        return reply
          .type('text/html')
          .send(`<h1>Already responded (${wo.vendorResponse ?? 'n/a'})</h1>`);
      }

      const status = action === 'accept' ? 'accepted' : 'rejected';
      await db
        .update(workOrders)
        .set({ status: status as never, vendorResponse: action, updatedAt: new Date() })
        .where(eq(workOrders.id, wo.id));
      await db.insert(workOrderEvents).values({
        tenantId: wo.tenantId,
        workOrderId: wo.id,
        eventType: `vendor.${action}`,
        actorType: 'vendor',
        payload: { via: 'dispatch_link' } as never,
      });
      await db.insert(requestAuditLog).values({
        tenantId: wo.tenantId,
        requestId: wo.requestId,
        action: 'vendor_dispatch',
        actorType: 'vendor',
        details: { workOrderId: wo.id, response: action, via: 'dispatch_link' } as never,
      });

      app.pubsub.publish({
        tenantId: wo.tenantId,
        type: 'work_order.updated',
        data: { id: wo.id, status },
        at: new Date().toISOString(),
      });

      const headline = action === 'accept' ? 'Job accepted' : 'Job declined';
      return reply
        .code(200)
        .type('text/html')
        .send(
          `<h1>${headline}</h1><p>Work order ${wo.id.slice(0, 8)} — thank you for letting us know.</p>`,
        );
    });
  }
}