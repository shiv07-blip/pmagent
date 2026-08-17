import { estimateCost, LLMError, type LLMCompleteOpts, type LLMProvider, type LLMResult, type LLMTool } from './types.js';

/**
 * Anthropic Messages API adapter. Uses fetch — no SDK dependency.
 * Structured output via tool forcing (tool_choice: {type:"tool"}) for the
 * classification phase.
 */

const API = 'https://api.anthropic.com/v1/messages';

export class AnthropicProvider implements LLMProvider {
  readonly providerName = 'anthropic';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly apiUrl: string = API,
  ) {}

  async complete(opts: LLMCompleteOpts): Promise<LLMResult> {
    const start = Date.now();
    const system = opts.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const messages = opts.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0,
      messages,
    };
    if (system) body.system = system;

    const tools = opts.tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    })) as LLMTool[] | undefined;
    if (tools?.length) {
      body.tools = tools;
      if (opts.jsonMode) {
        const first = tools[0];
        body.tool_choice = { type: 'tool', name: first!.name };
      }
    }

    let res: Response;
    try {
      res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
      });
    } catch (err) {
      throw new LLMError('Anthropic request failed', { retryable: true, cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const retryable = res.status >= 500 || res.status === 429;
      throw new LLMError(`Anthropic ${res.status}: ${text.slice(0, 300)}`, { retryable });
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };

    let content: string | null = null;
    const toolCalls: LLMResult['toolCalls'] = [];
    for (const block of data.content) {
      if (block.type === 'text') {
        content = (content ?? '') + (block.text ?? '');
      } else if (block.type === 'tool_use' && block.name) {
        toolCalls.push({ id: crypto.randomUUID(), name: block.name, arguments: block.input ?? {} });
      }
    }

    const promptTokens = data.usage.input_tokens;
    const completionTokens = data.usage.output_tokens;

    return {
      content,
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
