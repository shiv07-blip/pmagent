import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRequests } from '../hooks/useApi';
import { StatusBadge, UrgencyBadge, Spinner, PageHeader, EmptyState } from '../components/UI';
import { Search, MessageSquare, ChevronRight } from 'lucide-react';

const STATUS_FILTERS = ['all', 'new', 'triaging', 'awaiting_info', 'work_order_created', 'escalated', 'completed'];

export function RequestsPage() {
  const [status, setStatus] = useState('all');
  const { data, isLoading } = useRequests(status === 'all' ? undefined : { status });

  return (
    <div>
      <PageHeader title="Requests" description={`${data?.total ?? 0} total maintenance requests`} />
      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              status === s ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : !data?.requests.length ? (
        <EmptyState title="No requests" description="Requests will appear here when tenants message in." />
      ) : (
        <div className="space-y-3">
          {data.requests.map((r) => (
            <Link
              key={r.id}
              to={`/requests/${r.id}`}
              className="card flex items-center justify-between hover:shadow-md transition-shadow block"
            >
              <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-gray-400 w-20">{r.id.slice(0, 8)}</span>
                <StatusBadge status={r.status} />
                <UrgencyBadge urgency={r.urgency} />
                {r.category && (
                  <span className="badge bg-gray-100 text-gray-600">{r.category}</span>
                )}
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <MessageSquare size={14} />
                  <span className="truncate max-w-md">{r.body}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {r.confidence && (
                  <span className="text-xs text-gray-400">{(r.confidence * 100).toFixed(0)}%</span>
                )}
                <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</span>
                <ChevronRight size={16} className="text-gray-300" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
