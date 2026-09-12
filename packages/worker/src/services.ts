import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { EmbeddingProvider, LLMProvider } from '@pma/agent';
import type { AgentServices, PolicyHit, RequestContext, VendorSummary, WorkOrderCreated } from '@pma/agent';
import type { ClassificationInput } from '@pma/agent';
import type { NotifyKind } from '@pma/core';
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
import { ENV } from './env.js';

export interface AgentServicesOpts {
  db: Db;
  ctx: RequestContext;
  provider: LLMProvider;
  embedder: EmbeddingProvider;
  budgetLimitUsd: number;
  publish: (ev: PlatformEvent) => void;
  enqueueNotify: (
    kind: NotifyKind,
    payload: Record<string, unknown>,
    opts?: { delayMs?: number },
  ) => Promise<void>;
}

/** Wraps an already-loaded RequestContext with the database-backed effects. */
export function createAgentServices(opts: AgentServicesOpts): AgentServices {
  const { db, ctx, provider, budgetLimitUsd, embedder } = opts;
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
      await sendResidentMessage(requestId, body, {
        phone: ctx.resident.phone,
        email: ctx.resident.email,
        enqueueNotify: opts.enqueueNotify,
      });
    }
    opts.publish({
      tenantId,
      type: 'message.created',
      data: { requestId, message: msg },
      at: new Date().toISOString(),
    });
  }

  /** Ask for a CSAT rating some hours after a request completes. */
  async function scheduleCsat(): Promise<void> {
    const hours = typeof ctx.config.csatDelayHours === 'number' ? ctx.config.csatDelayHours : 24;
    const kind: NotifyKind | null =
      ctx.source === 'sms' && ctx.resident.phone
        ? 'resident_sms'
        : ctx.source === 'email' && ctx.resident.email
          ? 'resident_email'
          : null;
    if (!kind) return;
    const to = kind === 'resident_sms' ? ctx.resident.phone! : ctx.resident.email!;
    await db
      .update(maintenanceRequests)
      .set({ csatAskedAt: new Date() })
      .where(eq(maintenanceRequests.id, requestId));
    await opts.enqueueNotify(
      kind,
      {
        tenantId,
        to,
        subject: 'How was your maintenance experience?',
        body: `${ctx.resident.name}, how would you rate how your maintenance request was handled? Reply with a number between 1 (poor) and 5 (excellent).`,
      },
      { delayMs: hours * 60 * 60 * 1000 },
    );
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
      const hits: PolicyHit[] = [];
      let vectorRows: Array<{ docName: string; content: string; documentId: string; score: number }> = [];

      // 1) pgvector cosine search (existence of an embedding implies readiness).
      try {
        const vec = await embedder.embed(query);
        const vecLiteral = `'[${vec.join(',')}]'`;
        vectorRows = await db
          .select({
            docName: policyDocuments.name,
            content: policyChunks.content,
            documentId: policyChunks.documentId,
            score: sql<number>`1 - (${policyChunks.embedding} <=> ${vecLiteral}::vector)`,
          })
          .from(policyChunks)
          .innerJoin(policyDocuments, eq(policyDocuments.id, policyChunks.documentId))
          .where(and(
            eq(policyChunks.tenantId, tenantId),
            eq(policyDocuments.status, 'ready'),
          ))
          .orderBy(sql`${policyChunks.embedding} <=> ${vecLiteral}::vector`)
          .limit(3);
      } catch {
        vectorRows = []; // embedding unavailable — fall back to keyword search
      }
      hits.push(...vectorRows
        .filter((r) => r.score > 0.15)
        .map((r) => ({ docName: r.docName, content: r.content, score: Math.round(r.score * 100) / 100 })));

      // 2) Keyword fallback / complement — cat and one-off searches that
      //    embeddings miss (and the safety net when embedding fails).
      const words = query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2)
        .slice(0, 6);
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
      return dedupeHits(hits).slice(0, 3);
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

      // Auto-dispatch to the vendor with a token-scoped accept/decline link.
      if (!gateRequired && vendorId) {
        const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
        const token = randomBytes(24).toString('hex');
        await db
          .update(workOrders)
          .set({ dispatchToken: token, dispatchedAt: new Date(), vendorResponse: 'pending' })
          .where(eq(workOrders.id, wo!.id));

        if (vendor?.phone || vendor?.email) {
          const base = ENV.PUBLIC_BASE_URL ?? 'http://localhost:4000';
          const summary = `WO ${wo!.id.slice(0, 8)}: ${args.category} — ${ctx.unit.unitNumber}, ${ctx.unit.propertyName}. ${args.notes ? `Notes: ${args.notes}. ` : ''}`;
          const message =
            `${summary}Reply ACCEPT or DECLINE, or use:` +
            `\nAccept: ${base}/webhooks/vendor/${token}/accept` +
            `\nDecline: ${base}/webhooks/vendor/${token}/decline`;
          if (vendor.phone) {
            await opts.enqueueNotify('vendor_sms', { tenantId, to: vendor.phone, body: message });
          }
          if (vendor.email) {
            await opts.enqueueNotify('vendor_email', {
              tenantId,
              to: vendor.email,
              subject: `New dispatch — ${args.category} (WO ${wo!.id.slice(0, 8)})`,
              body: message,
            });
          }
          await db.insert(requestAuditLog).values({
            tenantId,
            requestId,
            action: 'vendor_dispatch',
            actorType: 'ai',
            details: { workOrderId: wo!.id, vendorId, dispatchedVia: vendor.phone ? 'sms' : 'email' } as never,
          });
        }
      }

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
      await scheduleCsat();
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

      // 4) LLM budget alert: warn the operator once per month at >= 80% spend.
      const [t] = await db
        .select({ spend: tenants.llmSpendMonthUsd, month: tenants.billingMonth, alerted: tenants.llmBudgetAlertSent })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const thisMonth = new Date().toISOString().slice(0, 7);
      const spend = t?.month === thisMonth ? Number(t.spend) : 0;
      if (budgetLimitUsd > 0 && spend >= budgetLimitUsd * 0.8 && t && !t.alerted) {
        await db
          .update(tenants)
          .set({ llmBudgetAlertSent: true })
          .where(eq(tenants.id, tenantId));
        await opts.enqueueNotify('pm_alert', {
          tenantId,
          to: ctx.config.oncall?.email ?? '',
          subject: 'LLM budget threshold reached',
          body: `LLM budget threshold reached for tenant ${tenantId.slice(0, 8)}: $${spend.toFixed(2)} spent / $${budgetLimitUsd.toFixed(2)} monthly budget (80%+).`,
        });
      }
    },
  };
}

function dedupeHits(hits: PolicyHit[]): PolicyHit[] {
  const seen = new Set<string>();
  const out: PolicyHit[] = [];
  for (const h of hits) {
    const key = `${h.docName}|${h.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}
