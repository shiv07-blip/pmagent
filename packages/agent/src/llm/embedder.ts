import { mockEmbedding } from '@pma/core';
import type { EmbeddingProvider } from './types.js';
import { LLMError } from './types.js';

/**
 * Embedding providers for RAG policy search. `OpenAiEmbedder` hits the real
 * embeddings API; `MockEmbedder` is deterministic and offline (used for dev,
 * tests, and the seed so vectors are comparable everywhere).
 */

export class MockEmbedder implements EmbeddingProvider {
  readonly providerName = 'mock';
  constructor(readonly model = 'mock-embed-1536') {}

  async embed(text: string): Promise<number[]> {
    return mockEmbedding(text);
  }
}

export class OpenAiEmbedder implements EmbeddingProvider {
  readonly providerName = 'openai';
  constructor(
    private readonly apiKey: string,
    readonly model = 'text-embedding-3-small',
    private readonly apiUrl = 'https://api.openai.com/v1/embeddings',
  ) {}

  async embed(text: string): Promise<number[]> {
    let res: Response;
    try {
      res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new LLMError('OpenAI embed request failed', { retryable: true, cause: err });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new LLMError(`OpenAI embed ${res.status}: ${body.slice(0, 300)}`, {
        retryable: res.status >= 500 || res.status === 429,
      });
    }
    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    const embedding = data.data[0]?.embedding;
    if (!embedding) {
      throw new LLMError('OpenAI embed returned no vector', { retryable: false });
    }
    return embedding;
  }
}

export function createEmbedder(opts?: {
  provider?: string;
  openaiApiKey?: string;
  model?: string;
}): EmbeddingProvider {
  const provider = opts?.provider ?? process.env.EMBEDDING_PROVIDER ?? 'mock';
  const model = opts?.model ?? process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
  switch (provider) {
    case 'openai': {
      const key = opts?.openaiApiKey ?? process.env.OPENAI_API_KEY;
      if (!key) throw new Error('EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY');
      return new OpenAiEmbedder(key, model);
    }
    case 'mock':
      return new MockEmbedder(model);
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER: ${provider}`);
  }
}