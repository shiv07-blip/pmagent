import { type ReactNode } from 'react';

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-800',
    triaging: 'bg-yellow-100 text-yellow-800',
    awaiting_info: 'bg-orange-100 text-orange-800',
    work_order_created: 'bg-purple-100 text-purple-800',
    escalated: 'bg-red-100 text-red-800',
    completed: 'bg-emerald-100 text-emerald-800',
    closed: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-gray-100 text-gray-600',
    proposed: 'bg-yellow-100 text-yellow-800',
    assigned: 'bg-blue-100 text-blue-800',
    in_progress: 'bg-indigo-100 text-indigo-800',
    active: 'bg-emerald-100 text-emerald-800',
  };
  return (
    <span className={`badge ${colors[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: string | null }) {
  if (!urgency) return null;
  const colors: Record<string, string> = {
    emergency: 'bg-red-100 text-red-800',
    urgent: 'bg-orange-100 text-orange-800',
    routine: 'bg-blue-100 text-blue-800',
    tenant_responsible: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`badge ${colors[urgency] ?? 'bg-gray-100 text-gray-700'}`}>
      {urgency}
    </span>
  );
}

export function StatCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: ReactNode }) {
  return (
    <div className="card flex items-start gap-4">
      {icon && <div className="rounded-lg bg-brand-50 p-2 text-brand-600">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-12">
      <p className="text-lg font-medium text-gray-900">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner() {
  return <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-600" />;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      </div>
      {action}
    </div>
  );
}
