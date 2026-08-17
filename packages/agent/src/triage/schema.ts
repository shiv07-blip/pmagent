import { z } from 'zod';
import { TRADES, URGENCIES } from '@pma/core';

export const classificationSchema = z.object({
  category: z.enum(TRADES),
  urgency: z.enum(URGENCIES),
  summary: z.string().max(200),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(500),
  requires_human_gate: z
    .object({
      kind: z.enum(['owner_approval', 'emergency', 'low_confidence', 'legal_compliance']),
      reason: z.string(),
      payload: z.record(z.unknown()),
    })
    .nullable(),
});

export type ClassificationInput = z.infer<typeof classificationSchema>;

export const ACTION_TOOLS = [
  {
    name: 'request_info',
    description: 'Ask the resident clarifying questions needed to scope the work.',
    inputSchema: {
      type: 'object',
      properties: { questions: { type: 'array', items: { type: 'string' } } },
      required: ['questions'],
    },
  },
  {
    name: 'search_policy',
    description:
      'Search tenant policies/lease terms to determine responsibility or required process before acting.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'create_work_order',
    description:
      'Create a proposed work order for a vendor. Include a vendor id only if a specific vendor was selected.',
    inputSchema: {
      type: 'object',
      properties: {
        vendorId: { type: 'string' },
        category: { type: 'string' },
        notes: { type: 'string' },
        estimatedCostUsd: { type: 'number' },
      },
      required: ['category', 'notes'],
    },
  },
  {
    name: 'resolve_first_touch',
    description:
      'Resolve the request without a vendor (e.g. walkthrough of a reset, tenant-responsible item).',
    inputSchema: {
      type: 'object',
      properties: { messageToResident: { type: 'string' }, notes: { type: 'string' } },
      required: ['messageToResident', 'notes'],
    },
  },
  {
    name: 'reply_to_resident',
    description: 'Send an informational reply to the resident (no work order).',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    name: 'escalate',
    description:
      'Hand the request to a human with a full context draft. Use for low confidence, legal/compliance, or emergencies.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string' }, notify: { type: 'boolean' } },
      required: ['reason'],
    },
  },
] as const;

export type ActionToolName = (typeof ACTION_TOOLS)[number]['name'];
