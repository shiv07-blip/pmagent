import type { RequestContext } from './services.js';
import { formatCents } from '@pma/core';

/** Builds the system prompt for both classification and action phases. */
export function buildSystemPrompt(ctx: RequestContext, policyHits: string[] = []): string {
  const lines: string[] = [];
  lines.push(
    'You are the triage agent for a property management company. You handle inbound tenant maintenance messages on behalf of a human property manager.',
    'Rules you must obey:',
    '1. NEVER handle a true emergency. Emergencies are caught by a separate rule engine before you run; if you still suspect one, call escalate immediately.',
    '2. Respect human-in-the-loop gates. If an action needs owner approval, high cost, or low confidence, call escalate with a complete draft instead of acting.',
    '3. For work that falls to the tenant per the lease, resolve first touch politely and cite the lease.',
    '4. Respond in the tenant\'s language. Be warm, specific, and never invent facts (prices, dates, availability).',
    '5. Only use search_policy to check responsibility when a request involves cost, damage, or ambiguity.',
  );

  lines.push('', '### Tenant configuration');
  lines.push(
    `Supported trades: ${ctx.config.supportedTrades.join(', ')}`,
    `Owner approval threshold: ${formatCents(ctx.config.ownerApprovalThresholdUsd * 100)}`,
    `ACK SLA (minutes): ${ctx.config.ackSlaMinutes}`,
  );

  lines.push('', '### Unit & resident');
  lines.push(
    `Unit ${ctx.unit.unitNumber} — ${ctx.unit.propertyName}, ${ctx.unit.address} (${ctx.unit.timezone})`,
    `Monthly rent: ${formatCents(ctx.unit.monthlyRentCents)}`,
    `Resident: ${ctx.resident.name}`,
  );

  if (ctx.lease) {
    lines.push('', '### Lease terms (responsibility)');
    lines.push(`Lease active ${ctx.lease.start} → ${ctx.lease.end}`);
    const tenantResp = ctx.lease.terms?.tenantResponsible ?? [];
    const landlordResp = ctx.lease.terms?.landlordResponsible ?? [];
    if (tenantResp.length) lines.push(`Tenant responsible: ${tenantResp.join('; ')}`);
    if (landlordResp.length) lines.push(`Landlord responsible: ${landlordResp.join('; ')}`);
  }

  if (ctx.openWorkOrders.length) {
    lines.push('', '### Open work orders');
    lines.push(
      `This request already has ${ctx.openWorkOrders.length} open work order(s): ${ctx.openWorkOrders
        .map((w) => `${w.status} (${w.id.slice(0, 8)})`)
        .join(', ')}. Do NOT resolve this request or create another work order — escalate instead.`,
    );
  }

  if (policyHits.length) {
    lines.push('', '### Relevant policy excerpts');
    policyHits.forEach((p, i) => lines.push(`[${i + 1}] ${p}`));
  }

  if (ctx.recentMessages.length) {
    lines.push('', '### Conversation so far');
    for (const m of ctx.recentMessages) {
      const who = m.direction === 'inbound' ? 'Resident' : 'Assistant';
      lines.push(`${who}: ${m.body}`);
    }
  }

  return lines.join('\n');
}
