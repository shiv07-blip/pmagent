const buckets = new Map<string, { windowStart: number; count: number }>();

/** Simple in-memory sliding-window rate limiter, keyed per tenant+scope. */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now - cur.windowStart > windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  cur.count += 1;
  return cur.count <= max;
}

export function rateLimitResponse(): { code: number; error: string; message: string } {
  return { code: 429, error: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded, try again shortly' };
}
