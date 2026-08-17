import { estimateCost, LLMError, type LLMCompleteOpts, type LLMProvider, type LLMResult } from './types.js';

/**
 * OpenAI Chat Completions adapter (fetch-based, no SDK). Structured output via
 * response_format json_object for the classification phase.
 */

const API = 'https://api.openai.com/v1/chat/completions';

export class OpenAIProvider implements LLMProvider {
  readonly providerName = 'openai';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly apiUrl: string = API,
  ) {}

  async complete(opts: LLMCompleteOpts): Promise<LLMResult> {
    const start = Date.now();
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: opts.temperature ?? 0,
      max_tokens: opts.maxTokens ?? 4096,
      messages: opts.messages,
    };
    if (opts.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }
    if (opts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    let res: Response;
    try {
      res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
      });
    } catch (err) {
      throw new LLMError('OpenAI request failed', { retryable: true, cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const retryable = res.status >= 500 || res.status === 429;
      throw new LLMError(`OpenAI ${res.status}: ${text.slice(0, 300)}`, { retryable });
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
      model: string;
    };

    const msg = data.choices[0]?.message;
    const toolCalls: LLMResult['toolCalls'] = [];
    for (const tc of msg?.tool_calls ?? []) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
      toolCalls.push({ id: tc.id, name: tc.function.name, arguments: args });
    }

    const promptTokens = data.usage.prompt_tokens;
    const completionTokens = data.usage.completion_tokens;

    return {
      content: msg?.content ?? null,
      toolCalls,
      usage: {
        promptTokens,
        completionTokens,
        costUsd: opts.costOverrideUsd ?? estimateCost(this.model, promptTokens, completionTokens),
      },
      provider: this.providerName,
      model: data.model,
      latencyMs: Date.now() - start,
    };
  }
}
