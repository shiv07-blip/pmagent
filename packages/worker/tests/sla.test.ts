import { describe, expect, it, vi } from 'vitest';

const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockResolvedValue([]),
};

vi.mock('@pma/db', () => ({
  workerDb: () => mockDb,
  maintenanceRequests: { id: 'id', tenantId: 'tenant_id', firstAckAt: 'first_ack_at', status: 'status', createdAt: 'created_at' },
}));

const { checkSlaBreaches } = await import('../src/handlers/sla.js');

describe('checkSlaBreaches', () => {
  it('returns 0 when no requests breached', async () => {
    mockDb.orderBy.mockResolvedValue([]);
    const escalate = vi.fn();
    const count = await checkSlaBreaches('t1', 60, escalate);
    expect(count).toBe(0);
    expect(escalate).not.toHaveBeenCalled();
  });

  it('escalates breached requests', async () => {
    mockDb.orderBy.mockResolvedValue([{ id: 'r1', createdAt: new Date('2026-01-01T00:00:00Z') }]);
    const escalate = vi.fn();
    const count = await checkSlaBreaches('t1', 60, escalate);
    expect(count).toBe(1);
    expect(escalate).toHaveBeenCalledWith('r1', expect.stringContaining('SLA breach'));
  });
});
