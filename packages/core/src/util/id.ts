import { randomUUID, randomBytes } from 'node:crypto';

export const newId = (): string => randomUUID();

/** Deterministic uuid v5-style key from a dedupe key + salt for idempotency. */
export function stableId(salt: string, value: string): string {
  const h = createHash(salt, value);
  const bytes = Buffer.from(h, 'hex').subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant
  return bytes.toString('hex');
}

function createHash(salt: string, value: string): string {
  // FNV-1a 64-bit x2 expanded to 16 bytes — cheap, dependency-free, stable.
  const data = Buffer.from(`${salt}\u0000${value}`, 'utf8');
  const out = Buffer.alloc(16);
  for (let lane = 0; lane < 2; lane++) {
    let h = 0xcbf29ce484222325n ^ BigInt(lane * 0x9e3779b9);
    const prime = 0x100000001b3n;
    for (let i = 0; i < data.length; i++) {
      h ^= BigInt(data[i]!);
      h = (h * prime) & 0xffffffffffffffffn;
    }
    out.writeBigUInt64LE(h, lane * 8);
  }
  return out.toString('hex');
}

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('hex');

export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
