import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { unauthorized } from '@pma/core';
import type { Role } from '@pma/core';
import { tenantMemberships, tenants, users, withTenant } from '@pma/db';
import type { Db } from '@pma/db';

export interface RequestCtx {
  userId: string;
  tenantId: string;
  role: Role;
  memberships: Array<{ tenantId: string; role: Role }>;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestCtx;
  }
  interface FastifyInstance {
    jwtSecret: string;
    pubsub: import('./pubsub.js').PubSub;
    queues: import('./queue.js').QueueBundle;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: Role) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.register(import('@fastify/jwt'), { secret: app.jwtSecret });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
      return;
    }

    const sub = (req.user as { sub?: string })?.sub;
    if (!sub) {
      reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid token payload' });
      return;
    }

    const ctx = await loadCtx(sub);
    if (!ctx) {
      reply.code(401).send({ error: 'UNAUTHORIZED', message: 'User no longer exists' });
      return;
    }

    // Tenant selection: header wins, else default (first active membership).
    const headerTenant = req.headers['x-tenant-id'];
    const selected =
      typeof headerTenant === 'string' &&
      ctx.memberships.some((m) => m.tenantId === headerTenant)
        ? headerTenant
        : ctx.memberships[0]?.tenantId;

    if (!selected) {
      reply.code(403).send({ error: 'FORBIDDEN', message: 'User has no tenant membership' });
      return;
    }

    req.ctx = {
      userId: sub,
      tenantId: selected,
      role: ctx.memberships.find((m) => m.tenantId === selected)!.role,
      memberships: ctx.memberships,
    };
  });

  app.decorate('requireRole', (role: Role) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const allowed = ['owner', 'admin'];
      if (!req.ctx || !allowed.includes(req.ctx.role)) {
        reply.code(403).send({ error: 'FORBIDDEN', message: `Requires ${role}` });
      }
    };
  });
}

/** Executes fn inside an RLS tenant transaction using the request context. */
export async function tx<T>(req: FastifyRequest, fn: (db: Db) => Promise<T>): Promise<T> {
  const ctx = req.ctx;
  if (!ctx) throw unauthorized();
  return withTenant(ctx.tenantId, ctx.userId, fn);
}

export async function loadCtx(userId: string): Promise<RequestCtx | null> {
  // Read-only across tenants: use worker (service) role, no RLS.
  const db = (await import('@pma/db')).workerDb();
  const rows = await db
    .select({ userId: users.id, tenantId: tenantMemberships.tenantId, role: tenantMemberships.role })
    .from(users)
    .innerJoin(tenantMemberships, eq(tenantMemberships.userId, users.id))
    .where(eq(users.id, userId));

  if (rows.length === 0) return null;
  const active = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(
      eq(tenants.status, 'active'),
      ...rows.map((r) => eq(tenants.id, r.tenantId)),
    ));
  const activeIds = new Set(active.map((a) => a.id));
  const memberships = rows
    .filter((r) => activeIds.has(r.tenantId))
    .map((r) => ({ tenantId: r.tenantId, role: r.role }));

  return {
    userId,
    tenantId: memberships[0]?.tenantId ?? '',
    role: memberships[0]?.role ?? 'readonly',
    memberships,
  };
}
