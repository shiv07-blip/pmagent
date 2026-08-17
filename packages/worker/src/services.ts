import { and, desc, eq, sql } from 'drizzle-orm';
import type { LLMProvider } from '@pma/agent';
import type { AgentServices, PolicyHit, RequestContext, VendorSummary, WorkOrderCreated } from '@pma/agent';
import type { ClassificationInput } from '@pma/agent';
import type { Db } from '@pma/db';
import {
  leases,
  llmRuns,
  maintenanceRequests,
  policyChunks,
  policyDocuments,
  requestAuditLog,
  requestMessages,
  tenants,
  units,
  vendors,
  workOrderEvents,
  workOrders,
} from '@pma/db';
import type { PlatformEvent } from './pubsub.js';
import { sendResidentMessage } from './services/outbound.js';

export interface AgentServicesOpts {
  db: Db;
  ctx: RequestContext;
  provider: LLMProvider;
  budgetLimitUsd: number;
  publish: (ev: PlatformEvent) => void;
  enqueueNotify: (kind: 'oncall_escalation' | 'pm_alert' | 'resident_sms' | 'resident_email', payload: Record<string, unknown>) => Promise<void>;
}

/** Wraps an already-loaded RequestContext with the database-backed effects. */
export function createAgentServices(opts: AgentServicesOpts): AgentServices {
  const { db, ctx, provider, budgetLimitUsd } = opts;
  const tenantId = ctx.tenantId;
  const requestId = ctx.requestId;

  async function insertOutboundMessage(
    body: string,
    senderType: 'ai' | 'system',
  ): Promise<void> {
    const [msg] = await db
      .insert(requestMessages)
      .values({
        tenantId,
        requestId,
        direction: 'outbound',
        channel: ctx.source as never,
        body,
        senderType: senderType as never,
      })
      .returning({ id: requestMessages.id, createdAt: requestMessages.createdAt });

    if (msg) {
      await db
        .update(maintenanceRequests)
        .set({ firstAckAt: sql`coalesce(first_ack_at, now())` })
        .where(eq(maintenanceRequests.id, requestId));
      await sendResidentMessage(requestId, body);
    }
    opts.publish({
      tenantId,
      type: 'message.created',
      data: { requestId, message: msg },
      at: new Date().toISOString(),
    });
  }

  return {
    async getContext() {
      return ctx;
    },

    async checkBudgetUsd() {
      const [t] = await db
        .select({ spend: tenants.llmSpendMonthUsd, month: tenants.billingMonth })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const thisMonth = new Date().toISOString().slice(0, 7);
      const spend = t?.month === thisMonth ? Number(t.spend) : 0;
      return Math.max(0, budgetLimitUsd - spend);
    },

    async listVendors(filter) {
      const rows = await db
        .select()
        .from(vendors)
        .where(and(
          eq(vendors.tenantId, tenantId),
          sql`${vendors.trades} @> ARRAY[${filter.category}]::trade[]`,
        ))
        .orderBy(desc(vendors.isPreferred), desc(vendors.emergencyCapable));
      return rows.map<VendorSummary>((v) => ({
        id: v.id,
        name: v.name,
        trades: v.trades as VendorSummary['trades'],
        serviceAreas: v.serviceAreas as VendorSummary['serviceAreas'],
        hourlyRateCents: v.hourlyRateCents,
        emergencyCapable: v.emergencyCapable,
        isPreferred: v.isPreferred,
      }));
    },

    async searchPolicy(query) {
      const words = query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2)
        .slice(0, 6);
      const hits: PolicyHit[] = [];
      for (const w of words) {
        const rows = await db
          .select({
            docName: policyDocuments.name,
            content: policyChunks.content,
            documentId: policyChunks.documentId,
          })
          .from(policyChunks)
          .innerJoin(policyDocuments, eq(policyDocuments.id, policyChunks.documentId))
          .where(and(
            eq(policyChunks.tenantId, tenantId),
            eq(policyDocuments.status, 'ready'),
            sql`${policyChunks.content} ilike ${`%${w}%`}`,
          ))
          .limit(2);
        hits.push(...rows.map((r) => ({ docName: r.docName, content: r.content, score: 1 })));
      }
      return hits.slice(0, 3);
    },

    async requestInfo(questions) {
      const body = questions.length ? questions.join('\n') : 'Could you share a few more details about the issue?';
      await insertOutboundMessage(body, 'ai');
      await db
        .update(maintenanceRequests)
        .set({ status: 'awaiting_info' })
        .where(eq(maintenanceRequests.id, requestId));
    },

    async createWorkOrder(args) {
      const estCostCents = args.estimatedCostUsd !== undefined
        ? Math.round(args.estimatedCostUsd * 100)
        : null;
      const thresholdUsd = ctx.config.ownerApprovalThresholdUsd;
      const needsApproval = estCostCents !== null && estCostCents / 100 > thresholdUsd;

      let vendorId: string | null = null;
      if (args.vendorId) vendorId = args.vendorId;
      if (!vendorId) {
        const matches = await this.listVendors({ category: args.category });
        vendorId = matches.find((v) => v.isPreferred)?.id
          ?? matches.find((v) => v.emergencyCapable)?.id
          ?? matches[0]?.id
          ?? null;
      }

      const gateRequired = needsApproval || !vendorId;
      const status = gateRequired ? 'proposed' : 'assigned';

      const [wo] = await db
        .insert(workOrders)
        .values({
          tenantId,
          requestId,
          vendorId: vendorId!,
          status: status as never,
          estCostCents,
          notes: args.notes,
        })
        .returning();

      await db.insert(workOrderEvents).values({
        tenantId,
        workOrderId: wo!.id,
        eventType: gateRequired ? 'created.proposed' : 'created.assigned',
        actorType: 'ai',
        payload: { vendorId, estCostCents, notes: args.notes } as never,
      });
      await db
        .update(maintenanceRequests)
        .set({ status: 'work_order_created' })
        .where(eq(maintenanceRequests.id, requestId));

      opts.publish({
        tenantId,
        type: 'work_order.created',
        data: { id: wo!.id, status },
        at: new Date().toISOString(),
      });
      return { workOrderId: wo!.id, status: status as WorkOrderCreated['status'], gateRequired };
    },

    async resolveFirstTouch(messageToResident, notes) {
      await insertOutboundMessage(messageToResident, 'ai');
      await db
        .update(maintenanceRequests)
        .set({ status: 'completed', closedAt: new Date(), aiNotes: { resolution: notes } as never })
        .where(eq(maintenanceRequests.id, requestId));
      await this.recordAudit('resolve_first_touch', { notes });
    },

    async replyToResident(message) {
      await insertOutboundMessage(message, 'ai');
      await db
        .update(maintenanceRequests)
        .set({ status: 'awaiting_info' })
        .where(eq(maintenanceRequests.id, requestId));
    },

    async escalate(reason, notify) {
      await db
        .update(maintenanceRequests)
        .set({ status: 'escalated', aiNotes: { escalation: reason } as never })
        .where(eq(maintenanceRequests.id, requestId));
      opts.publish({
        tenantId,
        type: 'request.escalated',
        data: { id: requestId, reason },
        at: new Date().toISOString(),
      });
      if (notify) {
        await opts.enqueueNotify('oncall_escalation', {
          tenantId,
          requestId,
          reason,
          subject: `URGENT: maintenance request ${requestId.slice(0, 8)}`,
        });
      }
    },

    async recordClassification(c: ClassificationInput) {
      await db
        .update(maintenanceRequests)
        .set({
          category: c.category as never,
          urgency: c.urgency as never,
          confidence: c.confidence as never,
          summary: c.summary,
          aiNotes: {
            evidence: c.evidence,
            gate: c.requires_human_gate,
          } as never,
        })
        .where(eq(maintenanceRequests.id, requestId));
      await db.insert(requestAuditLog).values({
        tenantId,
        requestId,
        action: 'classification',
        actorType: 'ai',
        details: { category: c.category, urgency: c.urgency, confidence: c.confidence } as never,
      });
    },

    async recordAudit(action, details) {
      await db.insert(requestAuditLog).values({
        tenantId,
        requestId,
        action: action as never,
        actorType: 'ai',
        details: details as never,
      });
    },

    async recordLlmRun(run) {
      const cost = Number(run.costUsd.toFixed(6));
      await db.insert(llmRuns).values({
        tenantId,
        requestId,
        provider: run.provider,
        model: run.model,
        status: run.status as never,
        promptTokens: run.promptTokens,
        completionTokens: run.completionTokens,
        costUsd: String(cost) as never,
        latencyMs: run.latencyMs,
        error: run.status === 'ok' ? null : 'llm_run_error',
      });
      await db.execute(
        sql`update tenants
            set llm_spend_month_usd = case
                when billing_month = to_char(now(),'YYYY-MM') then llm_spend_month_usd + ${cost}
                else ${cost}
              end,
              billing_month = to_char(now(),'YYYY-MM')
            where id = ${tenantId}`,
      );
    },
  };
}
