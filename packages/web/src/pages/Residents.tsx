import { useResidents } from '../hooks/useApi';
import { Spinner, PageHeader, EmptyState } from '../components/UI';
import { User, Mail, Phone } from 'lucide-react';

export function ResidentsPage() {
  const { data, isLoading } = useResidents();
  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const residents = data?.residents ?? [];

  return (
    <div>
      <PageHeader title="Residents" description={`${residents.length} total`} />
      {!residents.length ? (
        <EmptyState title="No residents" />
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Phone</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {residents.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 flex items-center gap-2">
                    <div className="rounded-full bg-brand-100 p-1.5"><User size={14} className="text-brand-600" /></div>
                    <span className="font-medium">{r.name}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{r.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{r.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
