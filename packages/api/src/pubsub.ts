import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';

export interface PlatformEvent {
  tenantId: string;
  type: string;
  data: Record<string, unknown>;
  at: string;
}

/**
 * In-process pub/sub for API→WebSocket fan-out, bridged to Redis so worker
 * processes can publish and the API (any instance) rebroadcasts to connected
 * sockets.
 */
export class PubSub {
  private readonly local = new EventEmitter();
  private readonly channel = 'pm.events';
  private sub: Redis | null = null;
  private pub: Redis | null = null;

  constructor(private readonly redisUrl?: string) {}

  async start(): Promise<void> {
    if (!this.redisUrl) return;
    this.pub = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.sub = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.sub.on('message', (_chan, raw) => {
      try {
        const ev = JSON.parse(raw) as PlatformEvent;
        this.local.emit(ev.tenantId, ev);
      } catch {
        /* ignore malformed */
      }
    });
    await this.sub.subscribe(this.channel);
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.pub?.quit(),
      this.sub?.quit(),
    ]);
    this.pub = null;
    this.sub = null;
  }

  publish(ev: PlatformEvent): void {
    this.local.emit(ev.tenantId, ev);
    this.pub?.publish(this.channel, JSON.stringify(ev)).catch(() => undefined);
  }

  subscribe(tenantId: string, cb: (ev: PlatformEvent) => void): () => void {
    this.local.on(tenantId, cb);
    return () => {
      this.local.off(tenantId, cb);
    };
  }
}
