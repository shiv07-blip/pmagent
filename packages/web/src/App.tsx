import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { RequestsPage } from './pages/Requests';
import { RequestDetailPage } from './pages/RequestDetail';
import { WorkOrdersPage } from './pages/WorkOrders';
import { ResidentsPage } from './pages/Residents';
import { VendorsPage } from './pages/Vendors';
import { AuditPage } from './pages/Audit';
import { UsagePage } from './pages/Usage';
import { Spinner } from './components/UI';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const { token, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/requests/:id" element={<RequestDetailPage />} />
        <Route path="/work-orders" element={<WorkOrdersPage />} />
        <Route path="/residents" element={<ResidentsPage />} />
        <Route path="/vendors" element={<VendorsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/usage" element={<UsagePage />} />
      </Route>
    </Routes>
  );
}
