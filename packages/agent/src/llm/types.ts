/**
 * LLM provider contract. Kept deliberately small so providers are swappable
 * (Anthropic / OpenAI / mock) without touching agent orchestration.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMTool {
  name: string;
  description: string;
  /** JSON schema for the arguments object */
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface LLMResult {
  content: string | null;
  toolCalls: LLMToolCall[];
  usage: LLMUsage;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface LLMCompleteOpts {
  messages: LLMMessage[];
  tools?: LLMTool[];
  /** provider-specific "do structured output" flag */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** used by providers that charge by model+prompt (may be overridden by costFn) */
  costOverrideUsd?: number;
}

export interface LLMProvider {
  readonly providerName: string;
  readonly model: string;
  complete(opts: LLMCompleteOpts): Promise<LLMResult>;
}

export class LLMError extends Error {
  readonly retryable: boolean;
  constructor(message: string, opts: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'LLMError';
    this.retryable = opts.retryable ?? true;
  }
}

/** Default token pricing table (USD). Providers may override via costFn. */
export const DEFAULT_PRICING: Record<string, { in: number; out: number }> = {
  'claude-sonnet-4-20250514': { in: 3 / 1_000_000, out: 15 / 1_000_000 },
  'claude-haiku-4-20250514': { in: 1 / 1_000_000, out: 5 / 1_000_000 },
  'gpt-4o-mini': { in: 0.15 / 1_000_000, out: 0.6 / 1_000_000 },
  'gpt-4o': { in: 2.5 / 1_000_000, out: 10 / 1_000_000 },
};

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = DEFAULT_PRICING[model];
  if (!p) return 0;
  return promptTokens * p.in + completionTokens * p.out;
}
