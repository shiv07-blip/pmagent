import { describe, expect, it } from 'vitest';
import type { ClassificationInput } from '../src/index.js';
import { MockProvider } from '../src/index.js';
import type { RequestContext } from '../src/index.js';
import { runTriage } from '../src/index.js';
import type { AgentServices } from '../src/index.js';

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 't1',
    requestId: 'r1',
    requestBody: 'x',
    source: 'sms',
    status: 'new',
    unit: {
      id: 'u1',
      unitNumber: '101',
      propertyName: 'Maple St',
      address: '1 Maple St',
      timezone: 'America/New_York',
      monthlyRentCents: 180000,
    },
    resident: { id: 'res1', name: 'Jordan', phone: '+12025550123' },
    lease: {
      id: 'l1',
      start: '2024-01-01T00:00:00.000Z',
      end: '2025-01-01T00:00:00.000Z',
      status: 'active',
      terms: {},
    },
    recentMessages: [],
    config: {
      ownerApprovalThresholdUsd: 500,
      supportedTrades: ['plumbing', 'electrical', 'hvac', 'appliance', 'pest', 'common', 'other'],
      preferredVendorIds: [],
      ackSlaMinutes: 60,
      channels: [],
      emergencyKeywords: [],
    },
    openWorkOrders: [],
    ...overrides,
  };
}

class FakeServices implements AgentServices {
  ctx: RequestContext;
  budget = 100;
  escalated: Array<{ reason: string; notify: boolean }> = [];
  workOrders: Array<{ category: string; notes: string; estimatedCostUsd?: number }> = [];
  classifications: ClassificationInput[] = [];
  audits: Array<{ action: string; details: Record<string, unknown> }> = [];
  infoRequests: string[][] = [];
  resolved: Array<{ msg: string; notes: string }> = [];
  llmRuns: unknown[] = [];

  constructor(ctx: RequestContext) {
    this.ctx = ctx;
  }

  getContext() {
    return Promise.resolve(this.ctx);
  }
  checkBudgetUsd() {
    return Promise.resolve(this.budget);
  }
  listVendors() {
    return Promise.resolve([]);
  }
  searchPolicy() {
    return Promise.resolve([]);
  }
  requestInfo(questions: string[]) {
    this.infoRequests.push(questions);
    return Promise.resolve();
  }
  createWorkOrder(args: { category: string; notes: string; estimatedCostUsd?: number }) {
    this.workOrders.push(args);
    return Promise.resolve({ workOrderId: 'wo1', status: 'assigned' as const, gateRequired: false });
  }
  resolveFirstTouch(msg: string, notes: string) {
    this.resolved.push({ msg, notes });
    return Promise.resolve();
  }
  replyToResident() {
    return Promise.resolve();
  }
  escalate(reason: string, notify: boolean) {
    this.escalated.push({ reason, notify });
    return Promise.resolve();
  }
  recordClassification(c: ClassificationInput) {
    this.classifications.push(c);
    return Promise.resolve();
  }
  recordAudit(action: string, details: Record<string, unknown>) {
    this.audits.push({ action, details });
    return Promise.resolve();
  }
  recordLlmRun(run: unknown) {
    this.llmRuns.push(run);
    return Promise.resolve();
  }
}

const provider = new MockProvider();

describe('runTriage', () => {
  it('escalates a true emergency without consulting the model', async () => {
    const ctx = baseContext();
    const svc = new FakeServices(ctx);
    const outcome = await runTriage({ provider, services: svc, triggerText: 'gas leak!' });
    expect(outcome.status).toBe('escalated_emergency');
    expect(svc.escalated).toHaveLength(1);
    expect(svc.escalated[0]?.notify).toBe(true);
    expect(svc.classifications).toHaveLength(0);
  });

  it('escalates when the monthly LLM budget is exhausted', async () => {
    const ctx = baseContext();
    const svc = new FakeServices(ctx);
    svc.budget = 0;
    const outcome = await runTriage({ provider, services: svc, triggerText: 'sink dripping' });
    expect(outcome.status).toBe('escalated_budget');
  });

  it('classifies and then creates a work order for a repair request', async () => {
    const ctx = baseContext();
    const svc = new FakeServices(ctx);
    const outcome = await runTriage({ provider, services: svc, triggerText: 'my dishwasher is leaking, please repair it' });
    expect(outcome.status).toBe('work_order_created');
    expect(svc.classifications).toHaveLength(1);
    expect(svc.classifications[0]?.category).toBe('appliance');
    expect(svc.workOrders).toHaveLength(1);
    expect(svc.workOrders[0]?.category).toBe('appliance');
    expect(svc.audits.some((a) => a.action === 'work_order_created')).toBe(true);
  });

  it('asks for more info when the request is ambiguous', async () => {
    const ctx = baseContext();
    const svc = new FakeServices(ctx);
    const outcome = await runTriage({ provider, services: svc, triggerText: 'there is a leak under the sink, can you fix it?' });
    expect(outcome.status).toBe('awaiting_info');
    expect(svc.infoRequests).toHaveLength(1);
  });

  it('resolves first touch for a trivial issue', async () => {
    const ctx = baseContext();
    const svc = new FakeServices(ctx);
    const outcome = await runTriage({ provider, services: svc, triggerText: 'reset the refrigerator please' });
    expect(outcome.status).toBe('resolved');
    expect(svc.resolved).toHaveLength(1);
  });

  it('does not resolve first touch when an open work order exists', async () => {
    const ctx = baseContext();
    ctx.openWorkOrders = [{ id: 'wo1', status: 'assigned' }];
    const svc = new FakeServices(ctx);
    const outcome = await runTriage({ provider, services: svc, triggerText: 'reset the refrigerator please' });
    expect(outcome.status).toBe('escalated');
    expect(svc.resolved).toHaveLength(0);
    expect(svc.escalated).toHaveLength(1);
  });

  it('passes tenant emergency keywords through to the engine', async () => {
    const ctx = baseContext();
    ctx.config.emergencyKeywords = ['raw sewage'];
    const svc = new FakeServices(ctx);
    const outcome = await runTriage({ provider, services: svc, triggerText: 'there is raw sewage backing up' });
    expect(outcome.status).toBe('escalated_emergency');
  });
});
