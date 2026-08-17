import { AppError, upstreamTimeout } from '@pma/core';
import type { LLMProvider } from '../llm/types.js';
import { LLMError } from '../llm/types.js';
import { detectEmergency, emergencyEscalationMessage } from '../rules/emergencies.js';
import { classifyTicket } from './classifier.js';
import { buildSystemPrompt } from './context.js';
import { ACTION_TOOLS, type ClassificationInput } from './schema.js';
import type { AgentServices, RequestContext } from './services.js';

export const MAX_AGENT_STEPS = 6;

export interface TriageOutcome {
  status:
    | 'escalated_emergency'
    | 'escalated_budget'
    | 'escalated'
    | 'awaiting_info'
    | 'work_order_created'
    | 'resolved'
    | 'replied';
  reason?: string;
  classification?: ClassificationInput;
  steps: string[];
}

export interface RunTriageOpts {
  provider: LLMProvider;
  services: AgentServices;
  /** text to run the emergency engine against (latest inbound message) */
  triggerText: string;
}

export async function runTriage(opts: RunTriageOpts): Promise<TriageOutcome> {
  const { provider, services } = opts;
  const ctx = await services.getContext();
  const steps: string[] = [];

  /* 1. Safety floor: emergency rule engine (no LLM involved). */
  const emergency = detectEmergency(opts.triggerText, ctx.config.emergencyKeywords);
  if (emergency.isEmergency) {
    const message = emergencyEscalationMessage(emergency.matches);
    await services.escalate(message, true);
    await services.recordAudit('emergency_alert', {
      matches: emergency.matches.map((m) => ({ term: m.matchedTerm, reason: m.reason })),
    });
    return { status: 'escalated_emergency', reason: message, steps: [...steps, 'emergency_engine'] };
  }

  /* 2. Spend guardrail before burning tokens. */
  const budget = await services.checkBudgetUsd();
  if (budget !== null && budget <= 0) {
    const reason =
      'Tenant monthly LLM budget exhausted — routed to a human to keep quality guarantees.';
    await services.escalate(reason, false);
    await services.recordAudit('escalation', { reason });
    return { status: 'escalated_budget', reason, steps: [...steps, 'budget_guard'] };
  }

  /* 3. Phase A: classify. */
  let classification: ClassificationInput;
  try {
    const cls = await classifyTicket({
      provider,
      systemContext: buildSystemPrompt(ctx),
      ticketText: opts.triggerText,
      requestId: ctx.requestId,
      tenantId: ctx.tenantId,
    });
    classification = cls.classification;
    await services.recordLlmRun({
      provider: provider.providerName,
      model: cls.model,
      status: 'ok',
      promptTokens: cls.usage.promptTokens,
      completionTokens: cls.usage.completionTokens,
      costUsd: cls.usage.costUsd,
      latencyMs: cls.latencyMs,
    });
  } catch (err) {
    await services.recordAudit('escalation', { reason: 'classification failed', error: String(err) });
    throw err; // worker decides retry semantics
  }

  await services.recordClassification(classification);
  steps.push(`classify:${classification.category}/${classification.urgency}@${classification.confidence}`);

  if (classification.requires_human_gate) {
    const gate = classification.requires_human_gate;
    const reason = gate.reason;
    await services.escalate(reason, gate.kind === 'emergency');
    await services.recordAudit('escalation', { kind: gate.kind, reason });
    return { status: 'escalated', reason, classification, steps };
  }

  /* 4. Phase B: agent loop. */
  const policyHits: string[] = [];
  let loop = 0;
  for (;;) {
    if (loop >= MAX_AGENT_STEPS) {
      await services.escalate('Max agent steps reached without resolution.', false);
      await services.recordAudit('escalation', { reason: 'max_steps' });
      return { status: 'escalated', reason: 'max_steps', classification, steps };
    }
    loop++;

    const result = await safeComplete(provider, {
      messages: [
        { role: 'system', content: buildSystemPrompt(ctx, policyHits) },
        {
          role: 'user',
          content: `Triage this request. Last inbound message: ${opts.triggerText}`,
        },
      ],
      tools: ACTION_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      temperature: 0,
    });
    await services.recordLlmRun({
      provider: result.provider,
      model: result.model,
      status: 'ok',
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      costUsd: result.usage.costUsd,
      latencyMs: result.latencyMs,
    });

    if (result.toolCalls.length === 0) {
      await services.escalate('Agent returned no action.', false);
      return { status: 'escalated', reason: 'no_action', classification, steps };
    }

    for (const call of result.toolCalls) {
      const step = await executeTool(services, ctx, call.name, call.arguments, policyHits);
      steps.push(step.label);
      if (step.terminal) {
        return { status: step.status, reason: step.reason, classification, steps };
      }
    }
  }
}

async function safeComplete(
  provider: LLMProvider,
  opts: Parameters<LLMProvider['complete']>[0],
): ReturnType<LLMProvider['complete']> {
  try {
    return await provider.complete(opts);
  } catch (err) {
    if (err instanceof LLMError) {
      throw upstreamTimeout(`LLM call failed (${err.message})`, err);
    }
    throw err;
  }
}

interface ToolStep {
  label: string;
  terminal: boolean;
  status: 'awaiting_info' | 'work_order_created' | 'resolved' | 'replied' | 'escalated';
  reason?: string;
}

async function executeTool(
  services: AgentServices,
  ctx: RequestContext,
  name: string,
  args: Record<string, unknown>,
  policyHits: string[],
): Promise<ToolStep> {
  switch (name) {
    case 'request_info': {
      const questions = Array.isArray(args.questions)
        ? (args.questions as string[]).filter((q): q is string => typeof q === 'string')
        : [];
      await services.requestInfo(questions);
      await services.recordAudit('info_requested', { questions });
      return { label: 'request_info', terminal: true, status: 'awaiting_info' };
    }
    case 'search_policy': {
      const query = typeof args.query === 'string' ? args.query : '';
      const hits = await services.searchPolicy(query);
      for (const h of hits.slice(0, 3)) policyHits.push(`${h.docName}: ${h.content}`);
      await services.recordAudit('classification', { note: `policy_search:${query}` });
      return { label: 'search_policy', terminal: false, status: 'awaiting_info' };
    }
    case 'create_work_order': {
      const category = String(args.category ?? 'other');
      const notes = String(args.notes ?? '');
      const vendorId = typeof args.vendorId === 'string' ? args.vendorId : undefined;
      const est = typeof args.estimatedCostUsd === 'number' ? args.estimatedCostUsd : undefined;
      const wo = await services.createWorkOrder({ vendorId, category: category as never, notes, estimatedCostUsd: est });
      await services.recordAudit('work_order_created', { workOrderId: wo.workOrderId, gateRequired: wo.gateRequired });
      if (wo.gateRequired) {
        await services.escalate('Work order drafted for human approval.', false);
        await services.recordAudit('owner_approval', { workOrderId: wo.workOrderId });
      }
      return {
        label: 'create_work_order',
        terminal: true,
        status: 'work_order_created',
      };
    }
    case 'resolve_first_touch': {
      if (ctx.openWorkOrders.length > 0) {
        await services.escalate('Work order already open on this request; routing for human review.', true);
        await services.recordAudit('escalation', { reason: 'resolve_first_touch blocked: open work order' });
        return { label: 'escalate', terminal: true, status: 'escalated' };
      }
      const msg = String(args.messageToResident ?? '');
      const notes = String(args.notes ?? '');
      await services.resolveFirstTouch(msg, notes);
      await services.recordAudit('resolve_first_touch', { notes });
      return { label: 'resolve_first_touch', terminal: true, status: 'resolved' };
    }
    case 'reply_to_resident': {
      const msg = String(args.message ?? '');
      await services.replyToResident(msg);
      await services.recordAudit('message_sent', { body: msg });
      return { label: 'reply_to_resident', terminal: true, status: 'replied' };
    }
    case 'escalate': {
      const reason = String(args.reason ?? 'unspecified');
      const notify = args.notify === true;
      await services.escalate(reason, notify);
      await services.recordAudit('escalation', { reason, notify });
      return { label: 'escalate', terminal: true, status: 'escalated', reason };
    }
    default:
      throw new AppError({ code: 'INTERNAL', message: `Unknown tool: ${name}` });
  }
}
