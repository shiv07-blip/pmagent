import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { AppError, sanitizeJobId } from '@pma/core';
import type { IngestJobData } from '@pma/core';
import {
  leases,
  maintenanceRequests,
  requestAuditLog,
  requestMessages,
  residents,
  units,
  workerDb,
} from '@pma/db';
import type { Db } from '@pma/db';
import type { Queue } from 'bullmq';
import type { PlatformEvent } from '../pubsub.js';

/**
 * Ingest processor: attaches the inbound message to the latest open request for
 * that resident (≤30 days) or opens a new request, then enqueues the agent.
 */
export async function processIngest(data: IngestJobData, agentQueue: Queue, publish: (ev: PlatformEvent) => void): Promise<void> {
  const db = workerDb();

  const resident = await resolveResident(db, data);
  const unitId = await resolveUnit(db, data, resident?.id);
  const residentId = resident?.id ?? (await ensureUnknownResident(db, data))!;

  const openRequest = await db
    .select()
    .from(maintenanceRequests)
    .where(and(
      eq(maintenanceRequests.tenantId, data.tenantId),
      eq(maintenanceRequests.residentId, residentId),
      ne(maintenanceRequests.status, 'closed'),
      sql`${maintenanceRequests.createdAt} > now() - interval '30 days'`,
    ))
    .orderBy(desc(maintenanceRequests.createdAt))
    .limit(1);

  const request =
    openRequest[0] ??
    (await createRequest(db, data, residentId, unitId, publish));

  const inserted = await insertMessage(db, data, request.id, publish);
  if (!inserted) {
    return; // duplicate inbound message — already processed
  }

  // CSAT: a lone 1–5 reply on a completed request is a survey answer, not a
  // new maintenance issue — record it and do not spin up the agent.
  const csat = parseCsat(data.body);
  const csatMatch = (csat !== null ? openRequest[0] : undefined);
  if (csatMatch) {
    const scored = await db
      .update(maintenanceRequests)
      .set({ csatScore: csat })
      .where(and(
        eq(maintenanceRequests.id, csatMatch.id),
        isNull(maintenanceRequests.csatScore),
        sql`${maintenanceRequests.csatAskedAt} is not null`,
      ))
      .returning({ id: maintenanceRequests.id });
    if (scored.length > 0) {
      await db.insert(requestAuditLog).values({
        tenantId: data.tenantId,
        requestId: scored[0]!.id,
        action: 'csat',
        actorType: 'resident',
        details: { score: csat } as never,
      });
      publish({
        tenantId: data.tenantId,
        type: 'request.csat',
        data: { requestId: scored[0]!.id, score: csat },
        at: new Date().toISOString(),
      });
      return;
    }
  }

  await db.insert(requestAuditLog).values({
    tenantId: data.tenantId,
    requestId: request.id,
    action: openRequest[0] ? 'message_received' : 'request_created',
    actorType: 'system',
    details: { source: data.channel, dedupeKey: data.dedupeKey } as never,
  });

  await agentQueue.add(
    `agent:${request.id}:${data.dedupeKey}`,
    { requestId: request.id },
    { jobId: sanitizeJobId(`agent:${request.id}:${data.dedupeKey}`), removeOnComplete: 1000, removeOnFail: 1000 },
  );
}

async function resolveResident(db: Db, data: IngestJobData) {
  if (data.residentId) {
    const [r] = await db.select().from(residents).where(eq(residents.id, data.residentId));
    return r ?? null;
  }
  if (data.channel === 'sms') {
    const [r] = await db
      .select()
      .from(residents)
      .where(and(eq(residents.tenantId, data.tenantId), eq(residents.phone, data.senderRef)));
    return r ?? null;
  }
  if (data.channel === 'email') {
    const [r] = await db
      .select()
      .from(residents)
      .where(and(eq(residents.tenantId, data.tenantId), eq(residents.email, data.senderRef)));
    return r ?? null;
  }
  if (data.channel === 'telegram') {
    const [r] = await db
      .select({ id: residents.id, name: residents.name, phone: residents.phone, email: residents.email, tenantId: residents.tenantId })
      .from(residents)
      .innerJoin(maintenanceRequests, eq(maintenanceRequests.residentId, residents.id))
      .where(and(
        eq(maintenanceRequests.tenantId, data.tenantId),
        eq(maintenanceRequests.channelThreadId, data.senderRef),
      ))
      .limit(1);
    return r ?? null;
  }
  return null;
}

async function resolveUnit(db: Db, data: IngestJobData, residentId?: string) {
  if (data.unitId) return data.unitId;
  if (residentId) {
    const [lease] = await db
      .select({ unitId: leases.unitId })
      .from(leases)
      .where(and(eq(leases.residentId, residentId), eq(leases.status, 'active')))
      .limit(1);
    if (lease) return lease.unitId;
  }
  const [u] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.tenantId, data.tenantId), eq(units.status, 'occupied')))
    .limit(1);
  return u?.id ?? null;
}

async function ensureUnknownResident(db: Db, data: IngestJobData): Promise<string> {
  const existing = await resolveResident(db, { ...data, residentId: undefined });
  if (existing) return existing.id;
  const [r] = await db
    .insert(residents)
    .values({
      tenantId: data.tenantId,
      name: 'Unknown resident',
      phone: data.channel === 'sms' ? data.senderRef : null,
      email: data.channel === 'email' ? data.senderRef : null,
    })
    .returning({ id: residents.id });
  return r!.id;
}

async function createRequest(db: Db, data: IngestJobData, residentId: string, unitId: string | null, publish: (ev: PlatformEvent) => void) {
  if (!unitId) throw new AppError({ code: 'VALIDATION', message: 'No unit resolvable for inbound request' });
  const [req] = await db
    .insert(maintenanceRequests)
    .values({
      tenantId: data.tenantId,
      unitId,
      residentId,
      source: data.channel as never,
      channelThreadId: data.senderRef,
      subject: data.subject,
      body: data.body,
      status: 'new',
      photos: data.mediaUrls ?? ([] as never),
    })
    .returning();
  publish({
    tenantId: data.tenantId,
    type: 'request.created',
    data: { id: req!.id },
    at: new Date().toISOString(),
  });
  return req!;
}

async function insertMessage(db: Db, data: IngestJobData, requestId: string, publish: (ev: PlatformEvent) => void): Promise<boolean> {
  try {
    const rows = await db.execute(
      sql`
        insert into request_messages
          (id, tenant_id, request_id, direction, channel, body, sender_type, sender_id, media, dedupe_key, created_at)
        values
          (gen_random_uuid(), ${data.tenantId}, ${requestId}, 'inbound', ${data.channel}, ${data.body}, 'resident', NULL, ${JSON.stringify(data.mediaUrls ?? [])}::jsonb, ${data.dedupeKey}, now())
        on conflict (channel, dedupe_key) where dedupe_key is not null
        do nothing
        returning id
      `,
    );
    if (rows.rows.length === 0) return false;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return false;
    throw err;
  }
  publish({
    tenantId: data.tenantId,
    type: 'message.created',
    data: { requestId, message: { body: data.body } },
    at: new Date().toISOString(),
  });
  return true;
}

/** Recognizes a CSAT score reply: exactly one digit in 1..5. */
function parseCsat(body: string): number | null {
  const trimmed = body.trim();
  if (!/^\d{1}$/.test(trimmed)) return null;
  const n = parseInt(trimmed, 10);
  return n >= 1 && n <= 5 ? n : null;
}
