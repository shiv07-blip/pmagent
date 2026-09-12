import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Webhook authenticity helpers.
 *
 * Two schemes:
 *  - Twilio: `X-Twilio-Signature` header (HMAC-SHA1 over the canonical request:
 *    public URL followed by sorted form params). Verified with TWILIO_AUTH_TOKEN.
 *  - Custom: `X-Pma-Timestamp` + `X-Pma-Signature` headers (HMAC-SHA256 over
 *    `<ts>.<raw body>`) using WEBHOOK_SECRET. Used for msg91 / portal / email /
 *    telegram / vendor webhooks.
 *
 * Both are no-ops when the corresponding secret is not configured, so the
 * project keeps working in local development without a secret.
 */

export function rawBodyOf(req: FastifyRequest): Buffer {
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (raw && raw.length > 0) return raw;
  // Fallback: re-serialize the parsed body so signature checks still have
  // something deterministic to work with when raw capture is unavailable.
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

/** Twilio's official request validator algorithm. */
export function verifyTwilioSignature(
  authToken: string | undefined,
  publicUrl: string,
  post: Record<string, unknown>,
  signature: string | undefined,
): boolean {
  if (!authToken || !signature) return true; // not configured → skip (dev mode)
  let data = publicUrl;
  for (const [k, v] of Object.entries(post).sort(([a], [b]) => a.localeCompare(b))) {
    if (k.startsWith('x-')) continue;
    data += k + String(v);
  }
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  return safeEqual(expected, signature);
}

/** Custom HMAC signature over `X-Pma-Timestamp` + raw body. */
export function verifyPmaSignature(
  secret: string | undefined,
  rawBody: Buffer | string,
  timestamp: string | undefined,
  signature: string | undefined,
  windowMs = 300_000,
): boolean {
  if (!secret) return true; // not configured → skip (dev mode)
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > windowMs) return false;
  const expected = createHmac('sha256', secret)
    .update(`${ts}.${rawBody.toString()}`)
    .digest('hex');
  return safeEqual(expected, signature);
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Verifies the webhook on the request, short-circuiting with 401 if invalid. */
export async function requireValidWebhook(
  req: FastifyRequest & { body?: unknown },
  reply: FastifyReply,
  opts: { secret?: string; twilioAuthToken?: string; isTwilio?: boolean },
): Promise<boolean> {
  const raw = rawBodyOf(req);

  if (opts.isTwilio) {
    const signature = String(req.headers['x-twilio-signature'] ?? '');
    const url = buildTwilioUrl(req);
    if (!verifyTwilioSignature(opts.twilioAuthToken, url, (req.body as Record<string, unknown>) ?? {}, signature)) {
      reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid webhook signature' });
      return false;
    }
    return true;
  }

  const timestamp = String(req.headers['x-pma-timestamp'] ?? '');
  const signature = String(req.headers['x-pma-signature'] ?? '');
  if (!verifyPmaSignature(opts.secret, raw, timestamp, signature)) {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid webhook signature' });
    return false;
  }
  return true;
}

function buildTwilioUrl(req: FastifyRequest): string {
  const base = process.env.PUBLIC_BASE_URL ?? `http://${req.headers.host ?? 'localhost'}`;
  try {
    const u = new URL(req.url, base);
    return u.href;
  } catch {
    return `${base}${req.url}`;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}