/**
 * Tiny Prometheus text-format metrics. Kept dependency-free: an in-process
 * HTTP counter fed from Fastify's onResponse hook, plus snapshot gauges that
 * routes attach (e.g. BullMQ queue depths, request volume per status).
 */

interface Counters {
  httpRequestsTotal: Map<string, number>; // "method path status"
  httpRequestDurationSumMs: Map<string, number>;
  httpRequestDurationCount: Map<string, number>;
}

const counters: Counters = {
  httpRequestsTotal: new Map(),
  httpRequestDurationSumMs: new Map(),
  httpRequestDurationCount: new Map(),
};

export function recordHttpRequest(method: string, path: string, status: number, latencyMs: number): void {
  const key = `${method} ${path} ${status}`;
  counters.httpRequestsTotal.set(key, (counters.httpRequestsTotal.get(key) ?? 0) + 1);
  counters.httpRequestDurationSumMs.set(key, (counters.httpRequestDurationSumMs.get(key) ?? 0) + latencyMs);
  counters.httpRequestDurationCount.set(key, (counters.httpRequestDurationCount.get(key) ?? 0) + 1);
}

export function renderMetrics(gauges: Record<string, number>): string {
  const lines: string[] = [];
  lines.push('# HELP pmagent_uptime_seconds Process uptime');
  lines.push('# TYPE pmagent_uptime_seconds gauge');
  lines.push(`pmagent_uptime_seconds ${Math.floor(process.uptime())}`);

  for (const [name, value] of Object.entries(gauges)) {
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${value}`);
  }

  lines.push('# HELP pmagent_http_requests_total HTTP requests by method, path, status');
  lines.push('# TYPE pmagent_http_requests_total counter');
  for (const [key, count] of counters.httpRequestsTotal) {
    const [method, path, status] = key.split(' ');
    lines.push(`pmagent_http_requests_total{method="${method}",path="${path}",status="${status}"} ${count}`);
  }

  lines.push('# HELP pmagent_http_request_duration_ms HTTP request latency histogram helper (mean)');
  lines.push('# TYPE pmagent_http_request_duration_ms gauge');
  for (const [key, sum] of counters.httpRequestDurationSumMs) {
    const [method, path, status] = key.split(' ');
    const count = counters.httpRequestDurationCount.get(key) ?? 1;
    const mean = count > 0 ? sum / count : 0;
    lines.push(`pmagent_http_request_duration_ms{method="${method}",path="${path}",status="${status}"} ${mean.toFixed(2)}`);
  }

  return lines.join('\n') + '\n';
}