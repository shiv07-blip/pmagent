import { and, desc, eq, sql } from 'drizzle-orm';
import { AppError } from '@pma/core';
import type { AgentJobData, TenantConfig } from '@pma/core';
import { notFound } from '@pma/core';
import type { LLMProvider, RequestContext, TriageOutcome } from '@pma/agent';
import { runTriage } from '@pma/agent';
import { leases, maintenanceRequests, properties, requestMessages, residents, tenants, units, workOrders, workerDb } from '@pma/db';
import type { Db } from '@pma/db';
import type { Queue } from 'bullmq';
import { createAgentServices } from '../services.js';
import type { PlatformEvent } from '../pubsub.js';

const DEFAULT_CONFIG: TenantConfig = {
  ownerApprovalThresholdUsd: 500,
  supportedTrades: ['plumbing', 'electrical', 'hvac', 'appliance', 'pest', 'common', 'other'],
  preferredVendorIds: [],
  ackSlaMinutes: 60,
  channels: [],
  emergencyKeywords: [],
};

export interface ProcessAgentOpts {
  data: AgentJobData;
  provider: LLMProvider;
  notifyQueue: Queue;
  budgetLimitUsd: number;
  publish: (ev: PlatformEvent) => void;
}

export async function processAgent(opts: ProcessAgentOpts): Promise<TriageOutcome> {
  const { data, provider, notifyQueue, budgetLimitUsd, publish } = opts;
  const db = workerDb();

  const ctx = await loadRequestContext(db, data.requestId);
  if (!ctx) throw notFound('Request not found');

  await db
    .update(maintenanceRequests)
    .set({ status: 'triaging' })
    .where(eq(maintenanceRequests.id, ctx.requestId));

  const enqueueNotify = async (
    kind: 'oncall_escalation' | 'pm_alert' | 'resident_sms' | 'resident_email',
    payload: Record<string, unknown>,
  ): Promise<void> => {
    await notifyQueue.add(
      `notify_${crypto.randomUUID()}`,
      { tenantId: ctx.tenantId, kind, payload },
      { removeOnComplete: 1000, removeOnFail: 1000 },
    );
  };

  const services = createAgentServices({
    db,
    ctx,
    provider,
    budgetLimitUsd,
    publish,
    enqueueNotify,
  });

  const triggerText = await latestInboundText(db, ctx.requestId, ctx.requestBody);
  const outcome = await runTriage({ provider, services, triggerText });

  await applyOutcome(db, ctx.requestId, ctx.tenantId, outcome);
  return outcome;
}

export async function loadRequestContext(db: Db, requestId: string): Promise<RequestContext | null> {
  const [req] = await db
    .select()
    .from(maintenanceRequests)
    .where(eq(maintenanceRequests.id, requestId));
  if (!req) return null;

  const [unit] = await db.select().from(units).where(eq(units.id, req.unitId));
  if (!unit) throw new AppError({ code: 'INTERNAL', message: 'Request unit missing' });
  const [property] = await db.select().from(properties).where(eq(properties.id, unit.propertyId));
  const [resident] = await db.select().from(residents).where(eq(residents.id, req.residentId));
  if (!resident) throw new AppError({ code: 'INTERNAL', message: 'Request resident missing' });
  const [lease] = await db
    .select()
    .from(leases)
    .where(and(eq(leases.residentId, resident.id), eq(leases.status, 'active')))
    .orderBy(desc(leases.startDate))
    .limit(1);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, req.tenantId));

  const recentMessages = await db
    .select()
    .from(requestMessages)
    .where(eq(requestMessages.requestId, requestId))
    .orderBy(requestMessages.createdAt)
    .limit(10);

  const openWorkOrders = await db
    .select({ id: workOrders.id, status: workOrders.status })
    .from(workOrders)
    .where(and(
      eq(workOrders.requestId, requestId),
      sql`${workOrders.status} not in ('completed', 'cancelled')`,
    ));

  const config = { ...DEFAULT_CONFIG, ...(tenant?.config as Record<string, unknown>) } as TenantConfig;

  return {
    tenantId: req.tenantId,
    requestId: req.id,
    requestBody: req.body,
    subject: req.subject ?? undefined,
    source: req.source,
    status: req.status,
    unit: {
      id: unit.id,
      unitNumber: unit.unitNumber,
      propertyName: property?.name ?? 'Unknown property',
      address: JSON.stringify(property?.address ?? {}),
      timezone: property?.timezone ?? 'UTC',
      monthlyRentCents: unit.monthlyRentCents,
    },
    resident: {
      id: resident.id,
      name: resident.name,
      phone: resident.phone ?? undefined,
      email: resident.email ?? undefined,
    },
    lease: lease
      ? {
          id: lease.id,
          start: lease.startDate.toISOString(),
          end: lease.endDate.toISOString(),
          status: lease.status,
          terms: lease.terms as Record<string, unknown>,
        }
      : null,
    recentMessages: recentMessages.map((m) => ({
      id: m.id,
      direction: m.direction,
      senderType: m.senderType,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
    config,
    openWorkOrders: openWorkOrders.map((w) => ({ id: w.id, status: w.status })),
  };
}

async function latestInboundText(db: Db, requestId: string, fallback: string): Promise<string> {
  const [m] = await db
    .select({ body: requestMessages.body })
    .from(requestMessages)
    .where(and(eq(requestMessages.requestId, requestId), eq(requestMessages.direction, 'inbound')))
    .orderBy(desc(requestMessages.createdAt))
    .limit(1);
  return m?.body ?? fallback;
}

async function applyOutcome(db: Db, requestId: string, tenantId: string, outcome: TriageOutcome): Promise<void> {
  const map: Record<TriageOutcome['status'], { status: string; closed?: boolean }> = {
    escalated_emergency: { status: 'escalated' },
    escalated_budget: { status: 'escalated' },
    escalated: { status: 'escalated' },
    awaiting_info: { status: 'awaiting_info' },
    work_order_created: { status: 'work_order_created' },
    resolved: { status: 'completed', closed: true },
    replied: { status: 'awaiting_info' },
  };
  const target = map[outcome.status];
  await db
    .update(maintenanceRequests)
    .set({ status: target.status as never, closedAt: target.closed ? new Date() : null })
    .where(eq(maintenanceRequests.id, requestId));
}
