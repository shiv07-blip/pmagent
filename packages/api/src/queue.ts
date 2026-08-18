import { Queue, type Job, type JobsOptions } from 'bullmq';
import { sanitizeJobId } from '@pma/core';
import type { AgentJobData, IngestJobData, NotifyJobData } from '@pma/core';

export type { IngestJobData, AgentJobData, NotifyJobData };

export interface QueueBundle {
  ingest: Queue<IngestJobData>;
  agent: Queue<AgentJobData>;
  notify: Queue<NotifyJobData>;
  close(): Promise<void>;
}

export function createQueues(redisUrl: string): QueueBundle {
  const u = new URL(redisUrl);
  const connection: Record<string, unknown> = {
    host: u.hostname,
    port: Number(u.port || 6379),
  };
  if (u.protocol === 'rediss:') {
    connection.tls = {};
  }

  const ingest = new Queue<IngestJobData>('ingest', {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 2000, removeOnFail: 5000 },
  });
  const agent = new Queue<AgentJobData>('agent', {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 5000, removeOnFail: 1000 },
  });
  const notify = new Queue<NotifyJobData>('notify', {
    connection,
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 5000, removeOnFail: 5000 },
  });

  return {
    ingest,
    agent,
    notify,
    async close() {
      await Promise.all([ingest.close(), agent.close(), notify.close()]);
    },
  };
}

/** Dedupe key becomes the job id, so duplicates are dropped by BullMQ. */
export async function enqueueIngest(
  q: Queue<IngestJobData>,
  data: IngestJobData,
  opts?: JobsOptions,
): Promise<Job<IngestJobData>> {
  return q.add(data.dedupeKey, data, { jobId: sanitizeJobId(data.dedupeKey), ...opts });
}
