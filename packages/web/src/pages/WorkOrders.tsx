import { useState } from 'react';
import { useWorkOrders, useApproveWorkOrder, useUpdateWorkOrderStatus } from '../hooks/useApi';
import { StatusBadge, Spinner, PageHeader, EmptyState } from '../components/UI';
import { CheckCircle, XCircle, Clock } from 'lucide-react';

const TRANSITIONS: Record<string, string[]> = {
  proposed: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
};

export function WorkOrdersPage() {
  const { data, isLoading } = useWorkOrders();
  const approve = useApproveWorkOrder();
  const updateStatus = useUpdateWorkOrderStatus();
  const [costInput, setCostInput] = useState<Record<string, string>>({});

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const orders = data?.work_orders ?? [];

  const handleApprove = async (id: string) => {
    const cost = costInput[id] ? Math.round(parseFloat(costInput[id]) * 100) : undefined;
    await approve.mutateAsync({ id, estCostCents: cost });
    setCostInput((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const handleTransition = async (id: string, status: string) => {
    const cost = costInput[id] ? Math.round(parseFloat(costInput[id]) * 100) : undefined;
    await updateStatus.mutateAsync({ id, status, actualCostCents: status === 'completed' ? cost : undefined });
    setCostInput((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  return (
    <div>
      <PageHeader title="Work Orders" description={`${orders.length} total`} />
      {!orders.length ? (
        <EmptyState title="No work orders" description="Work orders are created when the agent triages maintenance requests." />
      ) : (
        <div className="space-y-4">
          {orders.map((wo) => {
            const transitions = TRANSITIONS[wo.status] ?? [];
            return (
              <div key={wo.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-gray-400">{wo.id.slice(0, 8)}</span>
                      <StatusBadge status={wo.status} />
                    </div>
                    <p className="text-sm text-gray-600">{wo.notes ?? 'No notes'}</p>
                    <div className="flex gap-4 text-xs text-gray-400">
                      <span>Req: {wo.requestId.slice(0, 8)}</span>
                      <span>Vendor: {wo.vendorId?.slice(0, 8) ?? '—'}</span>
                      {wo.estCostCents != null && <span>Est: ${(wo.estCostCents / 100).toFixed(2)}</span>}
                      {wo.actualCostCents != null && <span>Actual: ${(wo.actualCostCents / 100).toFixed(2)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {wo.status === 'proposed' && (
                      <>
                        <input
                          type="number"
                          placeholder="Cost $"
                          value={costInput[wo.id] ?? ''}
                          onChange={(e) => setCostInput((p) => ({ ...p, [wo.id]: e.target.value }))}
                          className="input w-24 text-sm"
                        />
                        <button onClick={() => handleApprove(wo.id)} disabled={approve.isPending} className="btn-success text-sm">
                          <CheckCircle size={14} className="mr-1" /> Approve
                        </button>
                      </>
                    )}
                    {transitions.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          if (s === 'completed') {
                            setCostInput((p) => ({ ...p, [wo.id]: p[wo.id] ?? '' }));
                          }
                          handleTransition(wo.id, s);
                        }}
                        disabled={updateStatus.isPending}
                        className={s === 'cancelled' ? 'btn-danger text-sm' : 'btn-secondary text-sm'}
                      >
                        {s === 'cancelled' ? <XCircle size={14} className="mr-1" /> : <Clock size={14} className="mr-1" />}
                        {s.replace(/_/g, ' ')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
