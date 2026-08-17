import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  LayoutDashboard,
  Inbox,
  ClipboardList,
  Users,
  Truck,
  Shield,
  BarChart3,
  LogOut,
  Wifi,
  WifiOff,
} from 'lucide-react';

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/requests', icon: Inbox, label: 'Requests' },
  { to: '/work-orders', icon: ClipboardList, label: 'Work Orders' },
  { to: '/residents', icon: Users, label: 'Residents' },
  { to: '/vendors', icon: Truck, label: 'Vendors' },
  { to: '/audit', icon: Shield, label: 'Audit Log' },
  { to: '/usage', icon: BarChart3, label: 'Usage' },
];

export function Layout() {
  const { user, tenants, logout } = useAuth();
  const tenantId = tenants[0]?.tenantId ?? null;
  const { connected } = useWebSocket(localStorage.getItem('pma_token'), tenantId);

  return (
    <div className="flex h-screen">
      <aside className="w-64 bg-gray-900 text-gray-300 flex flex-col">
        <div className="px-6 py-5 border-b border-gray-800">
          <h1 className="text-xl font-bold text-white tracking-tight">pmagent</h1>
          <p className="text-xs text-gray-500 mt-0.5">Property Management AI</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                }`
              }
            >
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-gray-800">
          <div className="flex items-center gap-3 px-3 py-2 text-sm">
            {connected ? <Wifi size={14} className="text-emerald-400" /> : <WifiOff size={14} className="text-red-400" />}
            <span className="text-gray-500 text-xs">{tenants[0]?.name ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-sm text-gray-400 truncate">{user?.email}</span>
            <button onClick={logout} className="text-gray-500 hover:text-white transition-colors">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
