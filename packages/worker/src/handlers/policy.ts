import { and, eq, sql } from 'drizzle-orm';
import type { EmbeddingProvider } from '@pma/agent';
import type { PolicyJobData } from '@pma/core';
import { policyChunks, policyDocuments, workerDb } from '@pma/db';

/** Embeds a policy chunk and marks its document ready for search. */
export async function processPolicyEmbed(
  data: PolicyJobData,
  embedder: EmbeddingProvider,
): Promise<void> {
  const db = workerDb();
  let vec: number[];
  try {
    vec = await embedder.embed(data.content);
  } catch {
    await db
      .update(policyDocuments)
      .set({ status: 'failed', error: 'embedding provider unavailable' })
      .where(eq(policyDocuments.id, data.documentId));
    return;
  }

  await db.execute(sql`
    update policy_chunks
    set embedding = ${`[${vec.join(',')}]`}::vector
    where id = ${data.chunkId}
  `);
  await db
    .update(policyDocuments)
    .set({ status: 'ready', error: null })
    .where(and(eq(policyDocuments.id, data.documentId), eq(policyDocuments.status, 'processing')));
}