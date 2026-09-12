/**
 * Contracts for the async pipeline. The API writes these to BullMQ (with
 * `dedupeKey` used as the job id for idempotency); workers consume them.
 */

export const QUEUES = {
  ingest: 'ingest',
  agent: 'agent',
  notify: 'notify',
  policy: 'policy',
} as const;

export type JobQueue = (typeof QUEUES)[keyof typeof QUEUES];

export type IngestChannel = 'sms' | 'email' | 'portal' | 'voice' | 'telegram';

/** One incoming message that starts or continues a maintenance request. */
export interface IngestJobData {
  /** stable dedup key, e.g. twilio MessageSid → job id */
  dedupeKey: string;
  tenantId: string;
  channel: IngestChannel;
  /** resident phone (E.164) or email the message came from */
  senderRef: string;
  unitId?: string;
  residentId?: string;
  subject?: string;
  body: string;
  mediaUrls?: string[];
  receivedAt: string;
}

/** Runs the agent loop against one request. */
export interface AgentJobData {
  requestId: string;
  triggerMessageId?: string;
}

export type NotifyKind =
  | 'oncall_escalation'
  | 'pm_alert'
  | 'resident_sms'
  | 'resident_email'
  | 'resident_telegram'
  | 'vendor_sms'
  | 'vendor_email';

/** Sends an outbound notification through a channel provider. */
export interface NotifyJobData {
  tenantId: string;
  kind: NotifyKind;
  payload: Record<string, unknown>;
}

/** Embeds a stored policy chunk so it becomes searchable via pgvector. */
export interface PolicyJobData {
  chunkId: string;
  tenantId: string;
  documentId: string;
  content: string;
  reembed?: boolean;
}

export type Job = IngestJobData | AgentJobData | NotifyJobData | PolicyJobData;

export const dedupeKeyFor = (job: Job): string =>
  (job as { dedupeKey?: string }).dedupeKey ?? (job as { requestId?: string }).requestId ?? (job as { chunkId?: string }).chunkId ?? '';

/** BullMQ rejects job ids containing ':' — normalize for use as a jobId. */
export const sanitizeJobId = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_');
