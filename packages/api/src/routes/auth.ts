import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq, or, sql } from 'drizzle-orm';
import { AppError, conflict, unauthorized } from '@pma/core';
import { tenantMemberships, tenants, users, workerDb } from '@pma/db';
import { hashPassword, verifyPassword } from '../password.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
  companyName: z.string().min(1).max(120),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (req, reply) => {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }
    const { email, password, name, companyName } = body.data;

    const db = workerDb();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()));
    if (existing.length > 0) throw conflict('An account with this email already exists');

    const slug = slugify(companyName);
    const passwordHash = await hashPassword(password);

    let userId: string;
    let tenantId: string;
    try {
      const res = await db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ email: email.toLowerCase().trim(), name, passwordHash })
          .returning({ id: users.id });
        const [t] = await tx
          .insert(tenants)
          .values({ name: companyName, slug, config: defaultConfig() })
          .returning({ id: tenants.id });
        await tx
          .insert(tenantMemberships)
          .values({ tenantId: t!.id, userId: u!.id, role: 'owner' });
        return { userId: u!.id, tenantId: t!.id };
      });
      userId = res.userId;
      tenantId = res.tenantId;
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === '23505') {
        throw conflict('An account with this email already exists');
      }
      throw err;
    }

    const token = app.jwt.sign({ sub: userId });
    return reply.code(201).send({ token, userId, tenantId });
  });

  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });
    }
    const { email, password } = body.data;

    const db = workerDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()));
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw unauthorized('Invalid email or password');
    }

    const memberships = await db
      .select({ tenantId: tenantMemberships.tenantId, role: tenantMemberships.role, name: tenants.name, slug: tenants.slug, status: tenants.status })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(eq(tenantMemberships.userId, user.id));

    const token = app.jwt.sign({ sub: user.id });
    return reply.send({ token, user: { id: user.id, email: user.email, name: user.name }, tenants: memberships });
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    const db = workerDb();
    const [user] = await db.select().from(users).where(eq(users.id, req.ctx!.userId));
    if (!user) throw unauthorized('User not found');
    const memberships = await db
      .select({ tenantId: tenantMemberships.tenantId, role: tenantMemberships.role, name: tenants.name, slug: tenants.slug })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(eq(tenantMemberships.userId, user.id));
    return {
      user: { id: user.id, email: user.email, name: user.name },
      tenants: memberships,
    };
  });
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) + '-' + Math.random().toString(36).slice(2, 6)
  );
}

function defaultConfig() {
  return {
    ownerApprovalThresholdUsd: 500,
    supportedTrades: ['plumbing', 'electrical', 'hvac', 'appliance', 'pest', 'common', 'other'],
    preferredVendorIds: [],
    ackSlaMinutes: 60,
    channels: [],
    emergencyKeywords: [],
    languages: ['en'],
  };
}
