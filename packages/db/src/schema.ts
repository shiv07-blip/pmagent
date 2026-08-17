import {
  pgEnum,
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  boolean,
  numeric,
  uniqueIndex,
  index,
  primaryKey,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* Enums (keep in sync with @pma/core domain.ts)                       */
/* ------------------------------------------------------------------ */

export const ticketSourceEnum = pgEnum('ticket_source', ['sms', 'email', 'portal', 'voice', 'telegram']);

export const requestStatusEnum = pgEnum('request_status', [
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
]);

export const urgencyEnum = pgEnum('urgency', [
  'emergency',
  'urgent',
  'routine',
  'tenant_responsible',
]);

export const tradeEnum = pgEnum('trade', [
  'plumbing',
  'hvac',
  'electrical',
  'appliance',
  'structural',
  'pest',
  'lock',
  'common',
  'other',
]);

export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);

export const senderTypeEnum = pgEnum('sender_type', [
  'resident',
  'ai',
  'agent',
  'owner',
  'vendor',
  'system',
]);

export const workOrderStatusEnum = pgEnum('work_order_status', [
  'proposed',
  'assigned',
  'accepted',
  'scheduled',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
]);

export const roleEnum = pgEnum('role', ['owner', 'admin', 'agent', 'readonly']);

export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended']);

export const unitStatusEnum = pgEnum('unit_status', ['occupied', 'vacant', 'make_ready']);

export const leaseStatusEnum = pgEnum('lease_status', ['active', 'expired', 'pending']);

export const auditActionEnum = pgEnum('audit_action', [
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
]);

export const docTypeEnum = pgEnum('doc_type', ['policy', 'lease', 'faq']);

export const docStatusEnum = pgEnum('doc_status', ['processing', 'ready', 'failed']);

export const llmRunStatusEnum = pgEnum('llm_run_status', ['ok', 'error', 'timed_out']);

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: tenantStatusEnum('status').notNull().default('active'),
    config: jsonb('config').notNull().default({}),
    llmSpendMonthUsd: numeric('llm_spend_month_usd', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    billingMonth: text('billing_month'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tenants_slug_uq').on(t.slug)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    timezone: text('timezone').notNull().default('UTC'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    address: jsonb('address').notNull(),
    timezone: text('timezone').notNull().default('America/New_York'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('properties_tenant_idx').on(t.tenantId)],
);

export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    unitNumber: text('unit_number').notNull(),
    bedrooms: integer('bedrooms'),
    bathrooms: integer('bathrooms'),
    monthlyRentCents: integer('monthly_rent_cents').notNull().default(0),
    status: unitStatusEnum('status').notNull().default('vacant'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('units_tenant_idx').on(t.tenantId),
    index('units_property_idx').on(t.propertyId),
  ],
);

export const residents = pgTable(
  'residents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('residents_tenant_idx').on(t.tenantId),
    uniqueIndex('residents_phone_uq').on(t.tenantId, t.phone).where(sql`${t.phone} is not null`),
    uniqueIndex('residents_email_uq').on(t.tenantId, t.email).where(sql`${t.email} is not null`),
  ],
);

export const leases = pgTable(
  'leases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    residentId: uuid('resident_id')
      .notNull()
      .references(() => residents.id),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    depositCents: integer('deposit_cents').notNull().default(0),
    monthlyRentCents: integer('monthly_rent_cents').notNull().default(0),
    status: leaseStatusEnum('status').notNull().default('active'),
    terms: jsonb('terms').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('leases_tenant_idx').on(t.tenantId),
    index('leases_unit_idx').on(t.unitId),
    index('leases_resident_idx').on(t.residentId),
  ],
);

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    trades: tradeEnum('trades').array().notNull().default([]),
    serviceAreas: jsonb('service_areas').notNull().default({}),
    phone: text('phone'),
    email: text('email'),
    hourlyRateCents: integer('hourly_rate_cents'),
    emergencyCapable: boolean('emergency_capable').notNull().default(false),
    isPreferred: boolean('is_preferred').notNull().default(false),
    availability: jsonb('availability').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vendors_tenant_idx').on(t.tenantId),
    index('vendors_trades_idx').on(t.trades),
  ],
);

export const maintenanceRequests = pgTable(
  'maintenance_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    residentId: uuid('resident_id')
      .notNull()
      .references(() => residents.id),
    source: ticketSourceEnum('source').notNull(),
    channelThreadId: text('channel_thread_id'),
    subject: text('subject'),
    body: text('body').notNull(),
    status: requestStatusEnum('status').notNull().default('new'),
    urgency: urgencyEnum('urgency'),
    category: tradeEnum('category'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    summary: text('summary'),
    aiNotes: jsonb('ai_notes').notNull().default({}),
    photos: jsonb('photos').notNull().default([]),
    firstAckAt: timestamp('first_ack_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('requests_tenant_status_idx').on(t.tenantId, t.status),
    index('requests_unit_idx').on(t.unitId),
    index('requests_resident_idx').on(t.residentId),
    index('requests_created_idx').on(t.tenantId, t.createdAt),
  ],
);

export const requestMessages = pgTable(
  'request_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => maintenanceRequests.id, { onDelete: 'cascade' }),
    direction: messageDirectionEnum('direction').notNull(),
    channel: ticketSourceEnum('channel').notNull(),
    body: text('body').notNull(),
    senderType: senderTypeEnum('sender_type').notNull(),
    senderId: uuid('sender_id'),
    media: jsonb('media').notNull().default([]),
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_request_idx').on(t.requestId),
    index('messages_tenant_idx').on(t.tenantId),
    uniqueIndex('messages_dedupe_uq').on(t.channel, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
);

export const workOrders = pgTable(
  'work_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => maintenanceRequests.id),
    vendorId: uuid('vendor_id')
      .references(() => vendors.id),
    status: workOrderStatusEnum('status').notNull().default('proposed'),
    estCostCents: integer('est_cost_cents'),
    actualCostCents: integer('actual_cost_cents'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    slaResponseMinutes: integer('sla_response_minutes'),
    notes: text('notes'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('work_orders_tenant_idx').on(t.tenantId),
    index('work_orders_request_idx').on(t.requestId),
    index('work_orders_vendor_idx').on(t.vendorId),
  ],
);

export const workOrderEvents = pgTable(
  'work_order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    eventType: text('event_type').notNull(),
    actorType: senderTypeEnum('actor_type').notNull(),
    actorId: uuid('actor_id'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('wo_events_wo_idx').on(t.workOrderId), index('wo_events_tenant_idx').on(t.tenantId)],
);

export const requestAuditLog = pgTable(
  'request_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => maintenanceRequests.id, { onDelete: 'cascade' }),
    action: auditActionEnum('action').notNull(),
    actorType: senderTypeEnum('actor_type').notNull(),
    actorId: uuid('actor_id'),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_request_idx').on(t.requestId),
    index('audit_tenant_idx').on(t.tenantId, t.createdAt),
  ],
);

export const llmRuns = pgTable(
  'llm_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    requestId: uuid('request_id').references(() => maintenanceRequests.id),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: llmRunStatusEnum('status').notNull().default('ok'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    latencyMs: integer('latency_ms').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('llm_runs_tenant_idx').on(t.tenantId),
    index('llm_runs_created_idx').on(t.createdAt),
    index('llm_runs_request_idx').on(t.requestId),
  ],
);

export const policyDocuments = pgTable(
  'policy_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),
    docType: docTypeEnum('doc_type').notNull(),
    status: docStatusEnum('status').notNull().default('processing'),
    sourceUrl: text('source_url'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('policy_docs_tenant_idx').on(t.tenantId)],
);

export const policyChunks = pgTable(
  'policy_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => policyDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('policy_chunks_doc_idx').on(t.documentId),
    index('policy_chunks_tenant_idx').on(t.tenantId),
    index('policy_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

// Type helper for inserting config (matches @pma/core TenantConfig).
export type TenantRow = typeof tenants.$inferSelect;
export type TenantInsert = typeof tenants.$inferInsert;
export type MaintenanceRequestRow = typeof maintenanceRequests.$inferSelect;
export type UserRow = typeof users.$inferSelect;
