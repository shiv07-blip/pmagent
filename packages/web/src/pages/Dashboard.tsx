import { useDashboard } from '../hooks/useApi';
import { StatusBadge, UrgencyBadge, StatCard, Spinner } from '../components/UI';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Inbox, ClipboardList, AlertTriangle, Clock, DollarSign } from 'lucide-react';

const COLORS = ['#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#10b981', '#6b7280'];

export function DashboardPage() {
  const { data, isLoading } = useDashboard();
  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!data) return null;

  const requestPie = [
    { name: 'New', value: data.requests.new, color: '#0ea5e9' },
    { name: 'Triaging', value: data.requests.triaging, color: '#f59e0b' },
    { name: 'Awaiting Info', value: data.requests.awaitingInfo, color: '#f97316' },
    { name: 'WO Created', value: data.requests.workOrderCreated, color: '#8b5cf6' },
    { name: 'Escalated', value: data.requests.escalated, color: '#ef4444' },
    { name: 'Completed', value: data.requests.completed, color: '#10b981' },
  ].filter((d) => d.value > 0);

  const woBar = [
    { name: 'Proposed', count: data.work_orders.proposed },
    { name: 'Assigned', count: data.work_orders.assigned },
    { name: 'In Progress', count: data.work_orders.inProgress },
    { name: 'Completed', count: data.work_orders.completed },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open Requests" value={data.requests.open} icon={<Inbox size={20} />} />
        <StatCard label="Active Work Orders" value={data.work_orders.assigned + data.work_orders.inProgress} icon={<ClipboardList size={20} />} />
        <StatCard label="SLA Breaches (24h)" value={data.sla.unacked_24h} icon={<AlertTriangle size={20} />} sub={data.sla.unacked_24h > 0 ? 'Needs attention' : 'All clear'} />
        <StatCard label="Est. Costs" value={`$${(data.work_orders.estCostCents / 100).toFixed(0)}`} icon={<DollarSign size={20} />} sub="All work orders" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Requests by Status</h3>
          {requestPie.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={requestPie} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {requestPie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center text-gray-400 py-12">No requests yet</p>
          )}
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Work Orders by Status</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={woBar}>
              <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Recent Requests</h3>
          {data.recent_requests.length > 0 ? (
            <div className="space-y-3">
              {data.recent_requests.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-gray-400">{r.id.slice(0, 8)}</span>
                    <StatusBadge status={r.status} />
                    <UrgencyBadge urgency={r.urgency} />
                  </div>
                  <span className="text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-400 py-8">No requests</p>
          )}
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Recent Activity</h3>
          {data.recent_activity.length > 0 ? (
            <div className="space-y-3">
              {data.recent_activity.map((a, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-100 last:border-0">
                  <Clock size={14} className="text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">{a.action.replace(/_/g, ' ')}</span>
                      {' — '}
                      <span className="text-xs font-mono text-gray-400">{a.requestId?.slice(0, 8) ?? '—'}</span>
                    </p>
                    <p className="text-xs text-gray-400">{new Date(a.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-400 py-8">No activity</p>
          )}
        </div>
      </div>
    </div>
  );
}
