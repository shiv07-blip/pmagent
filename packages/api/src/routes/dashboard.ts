import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  maintenanceRequests,
  requestAuditLog,
  requestMessages,
  workOrders,
} from '@pma/db';
import { tx } from '../auth.js';

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req) => {
    return tx(req, async (db) => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [requestCounts] = await db
        .select({
          open: sql<number>`count(*) filter (where ${maintenanceRequests.status} not in ('closed', 'completed', 'cancelled'))::int`,
          new: sql<number>`count(*) filter (where ${maintenanceRequests.status} = 'new')::int`,
          triaging: sql<number>`count(*) filter (where ${maintenanceRequests.status} = 'triaging')::int`,
          awaitingInfo: sql<number>`count(*) filter (where ${maintenanceRequests.status} = 'awaiting_info')::int`,
          workOrderCreated: sql<number>`count(*) filter (where ${maintenanceRequests.status} = 'work_order_created')::int`,
          escalated: sql<number>`count(*) filter (where ${maintenanceRequests.status} = 'escalated')::int`,
          completed: sql<number>`count(*) filter (where ${maintenanceRequests.status} = 'completed')::int`,
          closed: sql<number>`count(*) filter (where ${maintenanceRequests.status} = 'closed')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(maintenanceRequests);

      const [woCounts] = await db
        .select({
          proposed: sql<number>`count(*) filter (where ${workOrders.status} = 'proposed')::int`,
          assigned: sql<number>`count(*) filter (where ${workOrders.status} = 'assigned')::int`,
          inProgress: sql<number>`count(*) filter (where ${workOrders.status} = 'in_progress')::int`,
          completed: sql<number>`count(*) filter (where ${workOrders.status} = 'completed')::int`,
          cancelled: sql<number>`count(*) filter (where ${workOrders.status} = 'cancelled')::int`,
          totalCostCents: sql<number>`coalesce(sum(${workOrders.actualCostCents}), 0)::int`,
          estCostCents: sql<number>`coalesce(sum(${workOrders.estCostCents}), 0)::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(workOrders);

      const [sla] = await db
        .select({
          unacked24h: sql<number>`count(*) filter (
            where ${maintenanceRequests.firstAckAt} is null
            and ${maintenanceRequests.status} not in ('closed', 'completed', 'cancelled')
            and ${maintenanceRequests.createdAt} < ${dayAgo}
          )::int`,
        })
        .from(maintenanceRequests);

      const recentActivity = await db
        .select({
          action: requestAuditLog.action,
          requestId: requestAuditLog.requestId,
          details: requestAuditLog.details,
          createdAt: requestAuditLog.createdAt,
        })
        .from(requestAuditLog)
        .orderBy(desc(requestAuditLog.createdAt))
        .limit(10);

      const recentRequests = await db
        .select({
          id: maintenanceRequests.id,
          status: maintenanceRequests.status,
          urgency: maintenanceRequests.urgency,
          category: maintenanceRequests.category,
          createdAt: maintenanceRequests.createdAt,
        })
        .from(maintenanceRequests)
        .orderBy(desc(maintenanceRequests.createdAt))
        .limit(5);

      return {
        requests: {
          ...requestCounts,
        },
        work_orders: {
          ...woCounts,
        },
        sla: {
          unacked_24h: sla?.unacked24h ?? 0,
        },
        recent_activity: recentActivity,
        recent_requests: recentRequests,
      };
    });
  });
}
