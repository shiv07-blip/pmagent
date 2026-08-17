import { useAudit } from '../hooks/useApi';
import { Spinner, PageHeader, EmptyState } from '../components/UI';
import { Shield, Clock } from 'lucide-react';

const ACTION_COLORS: Record<string, string> = {
  emergency_alert: 'bg-red-100 text-red-700',
  escalation: 'bg-orange-100 text-orange-700',
  work_order_created: 'bg-purple-100 text-purple-700',
  resolve_first_touch: 'bg-emerald-100 text-emerald-700',
  message_sent: 'bg-blue-100 text-blue-700',
  classification: 'bg-yellow-100 text-yellow-700',
};

export function AuditPage() {
  const { data, isLoading } = useAudit();
  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const entries = data?.entries ?? [];

  return (
    <div>
      <PageHeader title="Audit Log" description={`${entries.length} recent entries`} />
      {!entries.length ? (
        <EmptyState title="No audit entries" />
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Action</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Request</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Details</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <span className={`badge text-xs ${ACTION_COLORS[e.action] ?? 'bg-gray-100 text-gray-600'}`}>
                      {e.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{e.requestId?.slice(0, 8) ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{JSON.stringify(e.details)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                    <span className="flex items-center gap-1"><Clock size={12} /> {new Date(e.createdAt).toLocaleString()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
