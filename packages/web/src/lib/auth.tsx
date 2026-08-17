import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from './api';

interface User {
  id: string;
  email: string;
  name: string;
}

interface Tenant {
  tenantId: string;
  role: string;
  name: string;
  slug: string;
}

interface AuthState {
  user: User | null;
  tenants: Tenant[];
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('pma_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      api.setToken(token);
      api.getMe()
        .then((data) => {
          setUser(data.user);
          setTenants(data.tenants as Tenant[]);
        })
        .catch(() => {
          localStorage.removeItem('pma_token');
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.login(email, password);
    localStorage.setItem('pma_token', data.token);
    setToken(data.token);
    setUser(data.user);
    setTenants(data.tenants);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('pma_token');
    api.setToken(null);
    setToken(null);
    setUser(null);
    setTenants([]);
  }, []);

  return (
    <AuthContext.Provider value={{ user, tenants, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
