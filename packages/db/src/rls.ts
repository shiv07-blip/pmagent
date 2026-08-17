/**
 * RLS helper builders used by both the API and tests. Kept dependency-free.
 */

export interface TenantContext {
  tenantId: string;
  userId: string;
}

export const isTenantContext = (v: unknown): v is TenantContext =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as TenantContext).tenantId === 'string' &&
  typeof (v as TenantContext).userId === 'string';
