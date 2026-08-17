import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider } from './types.js';

export function createProvider(opts?: {
  provider?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  model?: string;
}): LLMProvider {
  const provider = opts?.provider ?? process.env.LLM_PROVIDER ?? 'mock';
  const model = opts?.model ?? process.env.LLM_MODEL ?? 'claude-sonnet-4-20250514';

  switch (provider) {
    case 'anthropic': {
      const key = opts?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
      return new AnthropicProvider(key, model);
    }
    case 'openai': {
      const key = opts?.openaiApiKey ?? process.env.OPENAI_API_KEY;
      if (!key) throw new Error('LLM_PROVIDER=openai requires OPENAI_API_KEY');
      return new OpenAIProvider(key, model);
    }
    case 'mock':
      return new MockProvider(model);
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  }
}
