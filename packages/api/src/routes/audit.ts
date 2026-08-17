import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { requestAuditLog, llmRuns } from '@pma/db';
import { tx } from '../auth.js';

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audit', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req) => {
    const { limit } = req.query as { limit?: string };
    const n = Math.min(Math.max(Number(limit ?? 100) || 100, 1), 500);
    return tx(req, async (db) => ({
      entries: await db
        .select()
        .from(requestAuditLog)
        .orderBy(desc(requestAuditLog.createdAt))
        .limit(n),
    }));
  });

  app.get('/metrics/usage', { preHandler: [app.authenticate, app.requireRole('admin')] }, async (req) => {
    return tx(req, async (db) => {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const [agg] = await db
        .select({
          runs: sql<number>`count(*)::int`,
          costUsd: sql<number>`coalesce(sum(${llmRuns.costUsd}), 0)`,
          promptTokens: sql<number>`coalesce(sum(${llmRuns.promptTokens}), 0)`,
          completionTokens: sql<number>`coalesce(sum(${llmRuns.completionTokens}), 0)`,
          p95LatencyMs: sql<number>`percentile_cont(0.95) within group (order by ${llmRuns.latencyMs})`,
        })
        .from(llmRuns)
        .where(sql`${llmRuns.createdAt} >= ${monthStart}`);

      const byModel = await db
        .select({ model: llmRuns.model, runs: sql<number>`count(*)::int`, costUsd: sql<number>`coalesce(sum(${llmRuns.costUsd}),0)` })
        .from(llmRuns)
        .where(sql`${llmRuns.createdAt} >= ${monthStart}`)
        .groupBy(llmRuns.model);

      return { usage: agg, by_model: byModel };
    });
  });
}
