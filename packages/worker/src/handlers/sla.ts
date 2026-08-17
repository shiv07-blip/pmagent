import { and, desc, eq, sql } from 'drizzle-orm';
import { maintenanceRequests, requestMessages, workerDb, type Db } from '@pma/db';

/**
 * Checks for requests that have not been acknowledged within the tenant's ACK SLA.
 * Called periodically by the worker on a schedule.
 */
export async function checkSlaBreaches(
  tenantId: string,
  ackSlaMinutes: number,
  escalate: (requestId: string, reason: string) => Promise<void>,
): Promise<number> {
  const db = workerDb();
  const deadline = new Date(Date.now() - ackSlaMinutes * 60 * 1000);

  const breached = await db
    .select({ id: maintenanceRequests.id, createdAt: maintenanceRequests.createdAt })
    .from(maintenanceRequests)
    .where(
      and(
        eq(maintenanceRequests.tenantId, tenantId),
        sql`${maintenanceRequests.firstAckAt} is null`,
        sql`${maintenanceRequests.status} not in ('closed', 'completed', 'cancelled', 'escalated')`,
        sql`${maintenanceRequests.createdAt} < ${deadline}`,
      ),
    )
    .orderBy(desc(maintenanceRequests.createdAt));

  let count = 0;
  for (const req of breached) {
    const reason = `SLA breach: request ${req.id.slice(0, 8)} not acknowledged within ${ackSlaMinutes} minutes (created ${req.createdAt.toISOString()})`;
    await escalate(req.id, reason);
    count++;
  }
  return count;
}
