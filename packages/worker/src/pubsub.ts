import { Redis } from 'ioredis';

export interface PlatformEvent {
  tenantId: string;
  type: string;
  data: Record<string, unknown>;
  at: string;
}

/** Publishes to the shared 'pm.events' Redis channel so API instances rebroadcast to WS. */
export function createPublisher(redisUrl: string): { publish(ev: PlatformEvent): void; close(): Promise<void> } {
  const client = new Redis(redisUrl, { maxRetriesPerRequest: null });
  return {
    publish(ev: PlatformEvent) {
      client.publish('pm.events', JSON.stringify(ev)).catch(() => undefined);
    },
    async close() {
      await client.quit().catch(() => undefined);
    },
  };
}
