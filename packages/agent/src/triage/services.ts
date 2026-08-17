import type { TenantConfig, Trade, Urgency } from '@pma/core';
import type { ClassificationInput } from './schema.js';

/** Everything the agent may need from the outside world. Implemented by the
 * worker (packages/worker) against Postgres. The agent package is pure. */

export interface RequestContext {
  tenantId: string;
  requestId: string;
  requestBody: string;
  source: string;
  subject?: string;
  status: string;
  unit: {
    id: string;
    unitNumber: string;
    propertyName: string;
    address: string;
    timezone: string;
    monthlyRentCents: number;
  };
  resident: { id: string; name: string; phone?: string; email?: string };
  lease: {
    id: string;
    start: string;
    end: string;
    status: string;
    terms: { tenantResponsible?: string[]; landlordResponsible?: string[]; [k: string]: unknown };
  } | null;
  recentMessages: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    senderType: string;
    body: string;
    createdAt: string;
  }>;
  config: TenantConfig;
  openWorkOrders: Array<{ id: string; status: string }>;
}

export interface VendorSummary {
  id: string;
  name: string;
  trades: Trade[];
  serviceAreas?: Record<string, unknown>;
  hourlyRateCents?: number | null;
  emergencyCapable: boolean;
  isPreferred: boolean;
}

export interface PolicyHit {
  docName: string;
  content: string;
  score: number;
}

export interface WorkOrderCreated {
  workOrderId: string;
  status: 'proposed' | 'assigned';
  gateRequired: boolean;
}

export interface AgentServices {
  getContext(): Promise<RequestContext>;
  checkBudgetUsd(): Promise<number | null>; // remaining monthly budget, null if none
  listVendors(filter: { category: Trade; serviceArea?: string }): Promise<VendorSummary[]>;
  searchPolicy(query: string): Promise<PolicyHit[]>;
  requestInfo(questions: string[]): Promise<void>;
  createWorkOrder(args: {
    vendorId?: string;
    category: Trade;
    notes: string;
    estimatedCostUsd?: number;
  }): Promise<WorkOrderCreated>;
  resolveFirstTouch(messageToResident: string, notes: string): Promise<void>;
  replyToResident(message: string): Promise<void>;
  escalate(reason: string, notify: boolean): Promise<void>;
  recordClassification(c: ClassificationInput): Promise<void>;
  recordAudit(action: string, details: Record<string, unknown>): Promise<void>;
  recordLlmRun(run: {
    provider: string;
    model: string;
    status: 'ok' | 'error' | 'timed_out';
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    latencyMs: number;
  }): Promise<void>;
}
