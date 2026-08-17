import { describe, expect, it, vi } from 'vitest';

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([{ n: 0 }]),
};

vi.mock('@pma/db', () => ({
  maintenanceRequests: { status: 'status', firstAckAt: 'first_ack_at', createdAt: 'created_at', id: 'id' },
  workOrders: { status: 'status', actualCostCents: 'actual_cost_cents', estCostCents: 'est_cost_cents', createdAt: 'created_at' },
  requestAuditLog: { action: 'action', requestId: 'request_id', details: 'details', createdAt: 'created_at' },
  requestMessages: {},
  ping: vi.fn(),
}));

describe('dashboard route', () => {
  it('returns correct shape', async () => {
    mockDb.limit.mockResolvedValue([]);
    mockDb.where.mockResolvedValue([{ n: 0 }]);
    mockDb.orderBy.mockReturnThis();

    const result = {
      requests: { open: 0, new: 0, triaging: 0, awaitingInfo: 0, workOrderCreated: 0, escalated: 0, completed: 0, closed: 0, total: 0 },
      work_orders: { proposed: 0, assigned: 0, inProgress: 0, completed: 0, cancelled: 0, totalCostCents: 0, estCostCents: 0, total: 0 },
      sla: { unacked_24h: 0 },
      recent_activity: [],
      recent_requests: [],
    };
    expect(result.requests).toHaveProperty('open');
    expect(result.work_orders).toHaveProperty('totalCostCents');
    expect(result.sla).toHaveProperty('unacked_24h');
  });
});
