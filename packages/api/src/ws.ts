import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { loadCtx } from './auth.js';
import type { PubSub } from './pubsub.js';

/** WebSocket realtime feed. Auth via ?token= (JWT) and optional &tenant=. */
export async function registerWs(app: FastifyInstance, pubsub: PubSub): Promise<void> {
  await app.register(import('@fastify/websocket'), { options: { maxPayload: 65536 } });

  app.get('/ws', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    if (!token) {
      socket.close(4001, 'missing token');
      return;
    }
    let ctx;
    try {
      await app.jwt.verify(token);
      const payload = app.jwt.decode(token) as { sub?: string };
      ctx = payload?.sub ? await loadCtx(payload.sub) : null;
    } catch {
      socket.close(4001, 'invalid token');
      return;
    }
    if (!ctx) {
      socket.close(4001, 'user not found');
      return;
    }

    const tenantId =
      (req.query as { tenant?: string }).tenant &&
      ctx.memberships.some((m) => m.tenantId === (req.query as { tenant?: string }).tenant)
        ? (req.query as { tenant?: string }).tenant!
        : ctx.memberships[0]!.tenantId;

    const unsubscribe = pubsub.subscribe(tenantId, (ev) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(ev));
      }
    });

    socket.send(JSON.stringify({ type: 'hello', data: { tenantId }, at: new Date().toISOString() }));

    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, 30_000);

    socket.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
