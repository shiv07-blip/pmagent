import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from '@pma/core';
import { ping } from '@pma/db';
import { registerAuth } from './auth.js';
import { ENV } from './env.js';
import type { PubSub } from './pubsub.js';
import { createQueues, type QueueBundle } from './queue.js';
import { checkRateLimit, rateLimitResponse } from './rateLimit.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPropertyRoutes } from './routes/properties.js';
import { registerRequestRoutes } from './routes/requests.js';
import { registerResidentRoutes } from './routes/residents.js';
import { registerTenantRoutes } from './routes/tenants.js';
import { registerVendorRoutes } from './routes/vendors.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerWorkOrderRoutes } from './routes/workorders.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerTelegramRoutes } from './routes/telegram.js';
import { registerWs } from './ws.js';

export interface AppDeps {
  pubsub: PubSub;
  queues: QueueBundle;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: ENV.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorate('jwtSecret', ENV.JWT_SECRET);
  app.decorate('pubsub', deps.pubsub);
  app.decorate('queues', deps.queues);

  await app.register(import('@fastify/cors'), {
    origin: (origin, cb) => {
      if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  });
  await app.register(import('@fastify/formbody'));

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    const key = req.ip;
    if (!checkRateLimit(key, ENV.LLM_PROVIDER === 'mock' ? 600 : 300, 60_000)) {
      const rl = rateLimitResponse();
      reply.code(rl.code).send({ error: rl.error, message: rl.message });
    }
  });

  await registerAuth(app);
  await registerWs(app, deps.pubsub);

  await app.register(registerAuthRoutes);
  await app.register(registerTenantRoutes);
  await app.register(registerPropertyRoutes);
  await app.register(registerResidentRoutes);
  await app.register(registerVendorRoutes);
  await app.register(registerRequestRoutes);
  await app.register(registerWorkOrderRoutes);
  await app.register(registerAuditRoutes);
  await app.register(registerDashboardRoutes);
  await app.register(registerTelegramRoutes);
  await app.register(registerWebhookRoutes);

  app.get('/healthz', async () => {
    await ping();
    return { ok: true, service: 'pma-api', version: '0.1.0' };
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.httpStatus).send({
        error: err.code,
        message: err.message,
        details: err.details,
      });
    }
    const validation = (err as { validation?: unknown }).validation;
    if (validation) {
      return reply.code(400).send({ error: 'VALIDATION', issues: validation });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'INTERNAL', message: 'Internal server error' });
  });

  return app;
}
