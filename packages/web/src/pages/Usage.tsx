import { useUsage } from '../hooks/useApi';
import { StatCard, Spinner, PageHeader } from '../components/UI';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Brain, Coins, Zap, Activity } from 'lucide-react';

export function UsagePage() {
  const { data, isLoading } = useUsage();
  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <PageHeader title="LLM Usage" description="Current month" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Runs" value={data.usage.runs} icon={<Brain size={20} />} />
        <StatCard label="Total Cost" value={`$${data.usage.costUsd.toFixed(4)}`} icon={<Coins size={20} />} />
        <StatCard label="Prompt Tokens" value={data.usage.promptTokens.toLocaleString()} icon={<Zap size={20} />} />
        <StatCard label="p95 Latency" value={`${data.usage.p95LatencyMs.toFixed(0)}ms`} icon={<Activity size={20} />} />
      </div>
      {data.by_model.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Cost by Model</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.by_model}>
              <XAxis dataKey="model" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v: number) => `$${v.toFixed(4)}`} />
              <Bar dataKey="costUsd" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
