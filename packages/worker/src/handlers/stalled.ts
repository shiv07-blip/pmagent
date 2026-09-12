import { and, eq, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Db } from '@pma/db';
import { maintenanceRequests } from '@pma/db';
import type { PlatformEvent } from '../pubsub.js';

export interface StalledCheckOpts {
  db: Db;
  agentQueue: Queue;
  emit: (ev: PlatformEvent) => void;
  /** how old (ms) an awaiting_info ticket must be before it is "stalled" */
  staleAgeMs: number;
  /** number of nudges before the ticket is escalated to a human */
  maxCount: number;
}

/**
 * Recovery ladder for requests stuck in awaiting_info: the first `maxCount−1`
 * checks re-run the agent (which follows up with the resident); once the
 * limit is hit the request escalates to a human.
 */
export async function checkStalledRequests(opts: StalledCheckOpts): Promise<number> {
  const { db, agentQueue, emit, staleAgeMs, maxCount } = opts;
  const cutoff = new Date(Date.now() - staleAgeMs);

  const rows = await db
    .select()
    .from(maintenanceRequests)
    .where(and(
      eq(maintenanceRequests.status, 'awaiting_info'),
      sql`${maintenanceRequests.updatedAt} < ${cutoff}`,
      sql`(${maintenanceRequests.lastStalledCheck} is null or ${maintenanceRequests.lastStalledCheck} < ${cutoff})`,
    ))
    .limit(50);

  let acted = 0;
  for (const r of rows) {
    const count = (r.stalledCount ?? 0) + 1;
    if (count > maxCount) continue;

    await db
      .update(maintenanceRequests)
      .set({ stalledCount: count, lastStalledCheck: new Date() })
      .where(eq(maintenanceRequests.id, r.id));

    if (count >= maxCount) {
      await db
        .update(maintenanceRequests)
        .set({ status: 'escalated' })
        .where(eq(maintenanceRequests.id, r.id));
      emit({
        tenantId: r.tenantId,
        type: 'request.escalated',
        data: { id: r.id, reason: `stalled after ${maxCount} follow-up(s)` },
        at: new Date().toISOString(),
      });
    } else {
      await agentQueue.add(
        `stall_${r.id}`,
        { requestId: r.id },
        { removeOnComplete: 1000, removeOnFail: 1000 },
      );
    }
    acted++;
  }
  return acted;
}