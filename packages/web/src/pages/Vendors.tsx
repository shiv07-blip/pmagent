import { useVendors } from '../hooks/useApi';
import { Spinner, PageHeader, EmptyState } from '../components/UI';
import { Truck, Star, Zap, DollarSign } from 'lucide-react';

export function VendorsPage() {
  const { data, isLoading } = useVendors();
  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const vendors = data?.vendors ?? [];

  return (
    <div>
      <PageHeader title="Vendors" description={`${vendors.length} total`} />
      {!vendors.length ? (
        <EmptyState title="No vendors" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors.map((v) => (
            <div key={v.id} className="card">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-brand-50 p-2"><Truck size={18} className="text-brand-600" /></div>
                  <div>
                    <h3 className="font-medium text-gray-900">{v.name}</h3>
                    <div className="flex gap-1 mt-1">
                      {v.trades.map((t) => (
                        <span key={t} className="badge bg-gray-100 text-gray-600 text-xs">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-4 mt-4 text-xs text-gray-500">
                {v.emergencyCapable && (
                  <span className="flex items-center gap-1 text-orange-600"><Zap size={12} /> Emergency</span>
                )}
                {v.isPreferred && (
                  <span className="flex items-center gap-1 text-yellow-600"><Star size={12} /> Preferred</span>
                )}
                {v.hourlyRateCents != null && (
                  <span className="flex items-center gap-1"><DollarSign size={12} /> ${(v.hourlyRateCents / 100).toFixed(0)}/hr</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
