import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { createEmbedder } from '@pma/agent';
import { notFound } from '@pma/core';
import { policyChunks, policyDocuments } from '@pma/db';
import { tx } from '../auth.js';
import { ENV } from '../env.js';

const createSchema = z.object({
  name: z.string().min(1),
  docType: z.enum(['policy', 'lease', 'faq']).default('policy'),
  content: z.string().min(1),
});

/**
 * Policy ingestion for RAG. Chunks the document, embeds every chunk
 * synchronously (real provider if EMBEDDING_PROVIDER=openai, deterministic
 * mock otherwise), and marks the document ready for `search_policy`.
 */
export async function registerPolicyRoutes(app: FastifyInstance): Promise<void> {
  const embedder = createEmbedder({ model: ENV.EMBEDDING_MODEL });

  app.get('/policies', { preHandler: [app.authenticate] }, async (req) => {
    return tx(req, async (db) => {
      const docs = await db
        .select({
          id: policyDocuments.id,
          name: policyDocuments.name,
          docType: policyDocuments.docType,
          status: policyDocuments.status,
          sourceUrl: policyDocuments.sourceUrl,
          createdAt: policyDocuments.createdAt,
        })
        .from(policyDocuments)
        .orderBy(desc(policyDocuments.createdAt));
      return { policies: docs };
    });
  });

  app.get('/policies/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string };
    return tx(req, async (db) => {
      const [doc] = await db.select().from(policyDocuments).where(eq(policyDocuments.id, id));
      if (!doc) throw notFound('Policy document not found');
      const chunks = await db
        .select({ chunkIndex: policyChunks.chunkIndex, content: policyChunks.content })
        .from(policyChunks)
        .where(eq(policyChunks.documentId, id))
        .orderBy(policyChunks.chunkIndex);
      return { policy: doc, chunks };
    });
  });

  app.post(
    '/policies',
    { preHandler: [app.authenticate, app.requireRole('admin')] },
    async (req, reply) => {
      const body = createSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'VALIDATION', issues: body.error.issues });

      return tx(req, async (db) => {
        const [doc] = await db
          .insert(policyDocuments)
          .values({
            tenantId: req.ctx!.tenantId,
            name: body.data.name,
            docType: body.data.docType as never,
            status: 'processing',
          })
          .returning();

        const chunks = chunkText(body.data.content);
        let failed = false;
        for (let i = 0; i < chunks.length; i++) {
          const [pc] = await db
            .insert(policyChunks)
            .values({
              tenantId: req.ctx!.tenantId,
              documentId: doc!.id,
              chunkIndex: i,
              content: chunks[i]!,
              embedding: Array(1536).fill(0) as never,
            })
            .returning({ id: policyChunks.id });
          try {
            const vec = await embedder.embed(chunks[i]!);
            await db.execute(sql`
              update policy_chunks
              set embedding = ${`[${vec.join(',')}]`}::vector
              where id = ${pc!.id}
            `);
          } catch {
            failed = true;
            break;
          }
        }

        const [saved] = await db
          .update(policyDocuments)
          .set({ status: failed ? 'failed' : 'ready', error: failed ? 'embedding failed' : null })
          .where(eq(policyDocuments.id, doc!.id))
          .returning();

        return { policy: saved, chunkCount: chunks.length };
      });
    },
  );

  app.delete(
    '/policies/:id',
    { preHandler: [app.authenticate, app.requireRole('admin')] },
    async (req) => {
      const { id } = req.params as { id: string };
      return tx(req, async (db) => {
        const [doc] = await db.select().from(policyDocuments).where(eq(policyDocuments.id, id));
        if (!doc) throw notFound('Policy document not found');
        await db.delete(policyDocuments).where(eq(policyDocuments.id, id));
        return { ok: true };
      });
    },
  );
}

/** Splits text into ~900-char chunks on sentence boundaries. */
export function chunkText(text: string, maxLen = 900): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('. ', maxLen);
    if (cut < maxLen / 2) {
      cut = rest.lastIndexOf('\n', maxLen);
      if (cut < maxLen / 2) cut = maxLen;
    } else {
      cut += 1; // include the period
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}