/**
 * Deterministic embedding helper shared by the agent mock embedder and the
 * database seed.
 *
 * Implementation detail: vectors are a signed feature-hash bag-of-words
 * (each token accelerates at a hash-chosen dimension with a random ± sign),
 * normalized to unit length. This is deterministic AND gives meaningful cosine
 * similarity for overlapping vocabulary, so the RAG demo / tests work offline
 * with pgvector (texts sharing words land closer together).
 */

export const EMBEDDING_DIMENSIONS = 1536;

// FNV-1a 32-bit — fast, deterministic.
function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic unit-length vector for a text (see module doc). */
export function mockEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);

  for (const word of tokens) {
    const h = hash32(word);
    const idx = h % EMBEDDING_DIMENSIONS;
    const sign = (h & 0x80000000) === 0 ? 1 : -1;
    vec[idx]! += sign;
  }

  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) vec[i]! /= norm;
  return vec;
}

/** Postgres vector literal for the mock embedding, e.g. '[0.1,0.2,...]'. */
export function embeddingLiteral(text: string): string {
  return `'[${mockEmbedding(text).join(',')}]'`;
}