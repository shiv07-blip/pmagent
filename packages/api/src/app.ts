import Fastify, { type FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
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
import { registerPolicyRoutes } from './routes/policies.js';
import { registerVendorWebhookRoutes } from './routes/vendor.js';
import { registerMetricsRoute } from './routes/metrics.js';
import { recordHttpRequest } from './metrics.js';
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

  // Capture the raw request body so webhooks can verify HMAC/Twilio signatures.
  app.addHook('preParsing', (req, _reply, payload, done) => {
    const chunks: Buffer[] = [];
    payload.on('data', (c: Buffer) => chunks.push(c));
    payload.on('end', () => {
      const raw = Buffer.concat(chunks);
      (req as unknown as { rawBody: Buffer }).rawBody = raw;
      done(null, Readable.from([raw]));
    });
    payload.on('error', done);
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    const key = req.ip;
    if (!checkRateLimit(key, ENV.LLM_PROVIDER === 'mock' ? 600 : 300, 60_000)) {
      const rl = rateLimitResponse();
      reply.code(rl.code).send({ error: rl.error, message: rl.message });
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const ms = reply.elapsedTime;
    recordHttpRequest(req.method, req.routeOptions?.url ?? req.url.split('?')[0]!, reply.statusCode, ms);
  });

  await registerAuth(app);

  await app.register(async (api) => {
    await api.register(registerAuthRoutes);
    await api.register(registerTenantRoutes);
    await api.register(registerPropertyRoutes);
    await api.register(registerResidentRoutes);
    await api.register(registerVendorRoutes);
    await api.register(registerRequestRoutes);
    await api.register(registerWorkOrderRoutes);
    await api.register(registerAuditRoutes);
    await api.register(registerDashboardRoutes);
    await api.register(registerPolicyRoutes);
    await registerWs(api, deps.pubsub);
  }, { prefix: '/api' });

  // Inbound webhooks from external services (Twilio/MSG91, Telegram, vendor
  // dispatch callbacks) and the Prometheus scrape endpoint stay at the root.
  await app.register(registerTelegramRoutes);
  await app.register(registerWebhookRoutes);
  await app.register(registerVendorWebhookRoutes);
  await app.register(registerMetricsRoute);

  app.get('/healthz', async () => {
    await ping();
    return { ok: true, service: 'pma-api', version: '0.1.0' };
  });

  // Serve the React SPA from the same origin in production.
  const webDistCandidates = [
    fileURLToPath(new URL('../../web/dist', import.meta.url)),
    fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  ];
  const webDist = webDistCandidates.find(
    (dir) => existsSync(join(dir, 'index.html')),
  );
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url === '/api') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Route not found' });
      }
      return reply.sendFile('index.html');
    });
  }

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
