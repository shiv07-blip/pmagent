import { z } from 'zod';
import { classificationSchema, type ClassificationInput } from './schema.js';
import type { LLMProvider } from '../llm/types.js';
import { LLMError } from '../llm/types.js';

export const Classification = classificationSchema;

export interface ClassifyResult {
  classification: ClassificationInput;
  usage: { promptTokens: number; completionTokens: number; costUsd: number };
  model: string;
  latencyMs: number;
}

export interface ClassifyOpts {
  provider: LLMProvider;
  systemContext: string;
  ticketText: string;
  requestId: string;
  tenantId: string;
}

/** Phase A: single structured classification call (JSON mode). */
export async function classifyTicket(opts: ClassifyOpts): Promise<ClassifyResult> {
  const { provider, systemContext, ticketText } = opts;

  const started = Date.now();
  const result = await provider.complete({
    jsonMode: true,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          systemContext +
          '\n\nClassify the maintenance request. Respond ONLY with JSON matching this schema:\n' +
          JSON.stringify(classificationShape()),
      },
      { role: 'user', content: ticketText },
    ],
  });

  const raw = result.content ?? '';
  const parsed = parseJson(raw);
  if (parsed === null) {
    throw new LLMError('Classifier returned non-JSON output', { retryable: true });
  }

  const safe = Classification.safeParse(parsed);
  if (!safe.success) {
    throw new LLMError(`Classifier returned invalid shape: ${safe.error.message}`, {
      retryable: true,
    });
  }

  return {
    classification: safe.data,
    usage: result.usage,
    model: result.model,
    latencyMs: Date.now() - started,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function classificationShape(): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  const s = classificationSchema.shape as unknown as Record<string, z.ZodTypeAny>;
  for (const [k, v] of Object.entries(s)) {
    if (v instanceof z.ZodEnum) {
      shape[k] = v.options;
    } else if (v instanceof z.ZodNumber) {
      shape[k] = 'number';
    } else if (v instanceof z.ZodString) {
      shape[k] = 'string';
    } else if (v instanceof z.ZodBoolean) {
      shape[k] = 'boolean';
    } else if (v instanceof z.ZodNullable || v instanceof z.ZodOptional) {
      shape[k] = describeNullable(v);
    } else {
      shape[k] = 'unknown';
    }
  }
  return shape;
}

function describeNullable(v: z.ZodTypeAny): unknown {
  const inner = (v as { innerType?: z.ZodTypeAny }).innerType;
  if (inner instanceof z.ZodEnum) return inner.options;
  if (inner instanceof z.ZodNumber) return 'number';
  return 'object|null';
}
