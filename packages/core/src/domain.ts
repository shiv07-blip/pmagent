/**
 * Shared domain vocabulary. The DB schema (packages/db) and the API layer
 * reference these enums; keep them in sync with the Drizzle `pgEnum`s.
 */

export const TICKET_SOURCES = ['sms', 'email', 'portal', 'voice'] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const REQUEST_STATUSES = [
  'new',
  'triaging',
  'awaiting_info',
  'work_order_created',
  'scheduled',
  'in_progress',
  'completed',
  'escalated',
  'closed',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Urgency tiers defined by the ops rulebook. */
export const URGENCIES = ['emergency', 'urgent', 'routine', 'tenant_responsible'] as const;
export type Urgency = (typeof URGENCIES)[number];

export const TRADES = [
  'plumbing',
  'hvac',
  'electrical',
  'appliance',
  'structural',
  'pest',
  'lock',
  'common',
  'other',
] as const;
export type Trade = (typeof TRADES)[number];

export const MSG_DIRECTIONS = ['inbound', 'outbound'] as const;
export type MessageDirection = (typeof MSG_DIRECTIONS)[number];

export const SENDER_TYPES = ['resident', 'ai', 'agent', 'owner', 'vendor', 'system'] as const;
export type SenderType = (typeof SENDER_TYPES)[number];

export const WORK_ORDER_STATUSES = [
  'proposed',
  'assigned',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'request_created',
  'message_received',
  'message_sent',
  'classification',
  'escalation',
  'emergency_alert',
  'work_order_created',
  'work_order_status',
  'vendor_dispatch',
  'owner_approval',
  'resolve_first_touch',
  'human_confirm',
  'info_requested',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const ROLES = ['owner', 'admin', 'agent', 'readonly'] as const;
export type Role = (typeof ROLES)[number];

export const VENDOR_TRADES = [...TRADES] as const;

/** Human-in-the-loop gates. Everything flagged here waits for a person. */
export interface HumanGate {
  kind: 'owner_approval' | 'emergency' | 'low_confidence' | 'legal_compliance';
  /** brief reason shown to the human reviewer */
  reason: string;
  /** structured payload the reviewer acts on */
  payload: Record<string, unknown>;
}

/** Result of the classification step of the triage agent. */
export interface Classification {
  category: Trade;
  urgency: Urgency;
  summary: string;
  confidence: number; // 0..1
  evidence: string;
  requires_gate: HumanGate | null;
}

export interface TenantChannelConfig {
  channel: TicketSource;
  /** provider identity, e.g. twilio phone number or email inbox */
  from: string;
  enabled: boolean;
}

export interface TenantConfig {
  /** USD threshold above which vendor estimates need owner approval */
  ownerApprovalThresholdUsd: number;
  /** trades (categories) this tenant handles; others route to human */
  supportedTrades: Trade[];
  /** vendors to prefer (by vendor id) before asking the LLM to pick */
  preferredVendorIds: string[];
  /** max hours between intake and ack before auto-escalation */
  ackSlaMinutes: number;
  channels: TenantChannelConfig[];
  /** tenant-specific free-text emergency keywords appended to defaults */
  emergencyKeywords: string[];
}

export interface MaintenanceRequestView {
  id: string;
  tenantId: string;
  unitId: string;
  residentId: string;
  source: TicketSource;
  channelThreadId?: string;
  subject?: string;
  body: string;
  status: RequestStatus;
  urgency?: Urgency;
  category?: Trade;
  confidence?: number;
  photos: string[];
  createdAt: Date;
  updatedAt: Date;
}
