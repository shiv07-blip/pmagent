import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { maintenanceRequests, workerDb } from '@pma/db';
import { renderMetrics } from '../metrics.js';

/** GET /metrics — Prometheus text output for scraping. No auth (ops endpoint). */
export async function registerMetricsRoute(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_req, reply) => {
    const db = workerDb();
    const gauges: Record<string, number> = {};

    try {
      const [q] = await db.select({
        active: sql<number>`count(*) filter (where status in ('new','triaging','awaiting_info'))::int`,
        open: sql<number>`count(*) filter (where status not in ('closed','completed','cancelled'))::int`,
        escalated: sql<number>`count(*) filter (where status = 'escalated')::int`,
      }).from(maintenanceRequests);
      gauges['pmagent_requests_active'] = q?.active ?? 0;
      gauges['pmagent_requests_open'] = q?.open ?? 0;
      gauges['pmagent_requests_escalated'] = q?.escalated ?? 0;
    } catch {
      gauges['pmagent_requests_active'] = 0;
    }

    const data = renderMetrics(gauges);
    return reply.type('text/plain; version=0.0.4').send(data);
  });
}