import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => api.getDashboard() });
}

export function useRequests(params?: { status?: string }) {
  return useQuery({ queryKey: ['requests', params], queryFn: () => api.getRequests(params) });
}

export function useRequest(id: string) {
  return useQuery({ queryKey: ['request', id], queryFn: () => api.getRequest(id) });
}

export function useWorkOrders() {
  return useQuery({ queryKey: ['workOrders'], queryFn: () => api.getWorkOrders() });
}

export function useResidents() {
  return useQuery({ queryKey: ['residents'], queryFn: () => api.getResidents() });
}

export function useVendors() {
  return useQuery({ queryKey: ['vendors'], queryFn: () => api.getVendors() });
}

export function useAudit(limit?: number) {
  return useQuery({ queryKey: ['audit', limit], queryFn: () => api.getAudit(limit) });
}

export function useUsage() {
  return useQuery({ queryKey: ['usage'], queryFn: () => api.getUsage() });
}

export function useTenant() {
  return useQuery({ queryKey: ['tenant'], queryFn: () => api.getTenant() });
}

export function useCloseRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution?: string }) => api.closeRequest(id, resolution),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requests'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: string; body: string }) => api.sendMessage(requestId, body),
    onSuccess: (_d, vars) => { qc.invalidateQueries({ queryKey: ['request', vars.requestId] }); },
  });
}

export function useApproveWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, estCostCents }: { id: string; estCostCents?: number }) => api.approveWorkOrder(id, estCostCents),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workOrders'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

export function useUpdateWorkOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, actualCostCents }: { id: string; status: string; actualCostCents?: number }) => api.updateWorkOrderStatus(id, status, actualCostCents),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workOrders'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });
}

export function useUpdateTenantConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) => api.updateTenantConfig(config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant'] }),
  });
}
