const API_BASE = '/api';

export interface ApiError {
  error: string;
  message: string;
  issues?: unknown[];
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: 'UNKNOWN', message: 'Request failed' }));
      throw error;
    }

    return res.json();
  }

  async login(email: string, password: string) {
    const data = await this.request<{
      token: string;
      user: { id: string; email: string; name: string };
      tenants: Array<{ tenantId: string; role: string; name: string; slug: string }>;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async getMe() {
    return this.request<{ user: { id: string; email: string; name: string }; tenants: Array<{ tenantId: string; role: string }> }>('/auth/me');
  }

  async getDashboard() {
    return this.request<{
      requests: { open: number; new: number; triaging: number; awaitingInfo: number; workOrderCreated: number; escalated: number; completed: number; closed: number; total: number };
      work_orders: { proposed: number; assigned: number; inProgress: number; completed: number; cancelled: number; totalCostCents: number; estCostCents: number; total: number };
      sla: { unacked_24h: number };
      recent_activity: Array<{ action: string; requestId: string; details: Record<string, unknown>; createdAt: string }>;
      recent_requests: Array<{ id: string; status: string; urgency: string | null; category: string | null; createdAt: string }>;
    }>('/dashboard');
  }

  async getRequests(params?: { status?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return this.request<{ requests: Array<{ id: string; tenantId: string; unitId: string; residentId: string; source: string; status: string; urgency: string | null; category: string | null; confidence: number | null; summary: string | null; body: string; createdAt: string }>; total: number }>(`/requests${q ? `?${q}` : ''}`);
  }

  async getRequest(id: string) {
    return this.request<{ request: { id: string; status: string; urgency: string | null; category: string | null; body: string; summary: string | null; confidence: number | null; source: string; aiNotes: Record<string, unknown> | null; createdAt: string }; messages: Array<{ id: string; direction: string; senderType: string; body: string; createdAt: string }> }>(`/requests/${id}`);
  }

  async closeRequest(id: string, resolution?: string) {
    return this.request(`/requests/${id}/close`, { method: 'POST', body: JSON.stringify({ resolution }) });
  }

  async sendMessage(requestId: string, body: string) {
    return this.request(`/requests/${requestId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
  }

  async getWorkOrders() {
    return this.request<{ work_orders: Array<{ id: string; requestId: string; vendorId: string | null; status: string; estCostCents: number | null; actualCostCents: number | null; notes: string | null; createdAt: string }> }>('/work_orders');
  }

  async approveWorkOrder(id: string, estCostCents?: number) {
    return this.request(`/work_orders/${id}/approve`, { method: 'POST', body: JSON.stringify({ estCostCents }) });
  }

  async updateWorkOrderStatus(id: string, status: string, actualCostCents?: number) {
    return this.request(`/work_orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, actualCostCents }) });
  }

  async getResidents() {
    return this.request<{ residents: Array<{ id: string; name: string; email: string | null; phone: string | null; createdAt: string }> }>('/residents');
  }

  async getVendors() {
    return this.request<{ vendors: Array<{ id: string; name: string; trades: string[]; emergencyCapable: boolean; isPreferred: boolean; hourlyRateCents: number | null }> }>('/vendors');
  }

  async getAudit(limit = 50) {
    return this.request<{ entries: Array<{ id: string; requestId: string; action: string; actorType: string; details: Record<string, unknown>; createdAt: string }> }>(`/audit?limit=${limit}`);
  }

  async getUsage() {
    return this.request<{ usage: { runs: number; costUsd: number; promptTokens: number; completionTokens: number; p95LatencyMs: number }; by_model: Array<{ model: string; runs: number; costUsd: number }> }>('/metrics/usage');
  }

  async getTenant() {
    return this.request<{ tenant: { id: string; name: string; slug: string; config: Record<string, unknown> } }>('/tenants/current');
  }

  async updateTenantConfig(config: Record<string, unknown>) {
    return this.request('/tenants/current/config', { method: 'PUT', body: JSON.stringify(config) });
  }
}

export const api = new ApiClient();
