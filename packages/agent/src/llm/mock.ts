import {
  DEFAULT_PRICING,
  estimateCost,
  type LLMMessage,
  type LLMProvider,
  type LLMResult,
  type LLMToolCall,
} from './types.js';

/**
 * Deterministic, dependency-free provider for development and tests.
 * It mirrors the real providers' contract but decides via keyword heuristics,
 * so the whole pipeline (ingest -> triage -> dispatch -> notify) runs without
 * an API key and with fully repeatable outputs.
 */

const TRADE_KEYWORDS: Array<[string, string[]]> = [
  ['plumbing', ['plumb', 'leak', 'toilet', 'sink', 'faucet', 'drain', 'pipe', 'water heater', 'garbage disposal']],
  ['hvac', ['hvac', 'ac', 'air condition', 'heat', 'heater', 'furnace', 'thermostat', 'cold', 'warm air']],
  ['electrical', ['electrical', 'electric', 'outlet', 'breaker', 'power out', 'lights', 'spark', 'wiring']],
  ['appliance', ['dishwasher', 'washer', 'dryer', 'oven', 'stove', 'refrigerator', 'fridge', 'microwave', 'appliance']],
  ['structural', ['wall', 'ceiling', 'roof', 'floor', 'door', 'window', 'crack', 'structural']],
  ['pest', ['pest', 'bug', 'roach', 'ant', 'mouse', 'rodent', 'termite', 'bed bug']],
  ['lock', ['lock', 'key', 'deadbolt', 'fob']],
];

function classifyText(text: string): { category: string; urgency: string; confidence: number; evidence: string } {
  const t = text.toLowerCase();
  let category = 'other';
  let bestScore = 0;
  for (const [trade, words] of TRADE_KEYWORDS) {
    let score = 0;
    for (const w of words) if (t.includes(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      category = trade;
    }
  }

  let urgency = 'routine';
  if (/(gas leak|burst pipe|no heat|flooding|smoke|fire|electrical fire|no hot water|no water)/.test(t)) {
    urgency = 'emergency';
  } else if (/(leak|no hot water|no heat|broken (ac|heater)|asap|urgent|today|immediately|emergency)/.test(t)) {
    urgency = 'urgent';
  } else if (/(clogged drain|bulb|filter|cosmetic|minor)/.test(t)) {
    urgency = 'routine';
  }

  const confidence = urgency === 'emergency' ? 0.99 : 0.9;
  return { category, urgency, confidence, evidence: 'mock-provider keyword match' };
}

function buildToolCall(name: string, args: Record<string, unknown>): LLMToolCall {
  return { id: `mock_${name}_${Math.random().toString(36).slice(2, 8)}`, name, arguments: args };
}

export class MockProvider implements LLMProvider {
  readonly providerName = 'mock';
  constructor(readonly model = 'mock-model-1') {}

  async complete(opts: {
    messages: LLMMessage[];
    jsonMode?: boolean;
    tools?: Array<{ name: string; description: string }>;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<LLMResult> {
    const start = Date.now();
    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    let content: string | null = null;
    let toolCalls: LLMToolCall[] = [];

    if (opts.jsonMode) {
      // Phase A: structured classification
      const c = classifyText(lastUser);
      content = JSON.stringify({
        category: c.category,
        urgency: c.urgency,
        summary: lastUser.slice(0, 120),
        confidence: c.confidence,
        evidence: c.evidence,
        requires_human_gate: c.urgency === 'emergency' ? {
          kind: 'emergency',
          reason: 'Emergency keywords matched during classification',
          payload: {},
        } : null,
      });
    } else if (opts.tools?.length) {
      const c = classifyText(lastUser);
      const hasInfoQuestion = /\?$/.test(lastUser.trim()) && c.urgency !== 'emergency';
      const hasVendorRequest = /(fix|repair|replace|install|leak|broken)/.test(lastUser.toLowerCase());
      const toolNames = opts.tools.map((t) => t.name);

      if (c.urgency === 'emergency') {
        if (toolNames.includes('escalate')) toolCalls.push(buildToolCall('escalate', { reason: `Emergency: ${c.category}`, notify: true }));
      } else if (hasInfoQuestion && toolNames.includes('request_info')) {
        toolCalls.push(buildToolCall('request_info', { questions: ['Which unit is affected?', 'How severe is the issue?'] }));
      } else if (hasVendorRequest && toolNames.includes('create_work_order')) {
        toolCalls.push(buildToolCall('create_work_order', { category: c.category, notes: `Fix ${c.category} issue: ${lastUser.slice(0, 140)}` }));
      } else if (toolNames.includes('resolve_first_touch')) {
        toolCalls.push(buildToolCall('resolve_first_touch', { messageToResident: 'This looks like a minor issue. Try resetting the appliance and let us know if it persists.', notes: 'resolved first touch' }));
      } else {
        toolCalls.push(buildToolCall('reply_to_resident', { message: `We have received your request regarding ${c.category}. A team member will be in touch.` }));
      }
    } else {
      content = 'Mock provider has no opinion.';
    }

    const promptTokens = estimatePromptTokens(opts.messages, opts.tools);
    const completionTokens = estimateCompletionTokens(content, toolCalls);
    const model = this.model;

    return {
      content,
      toolCalls,
      usage: {
        promptTokens,
        completionTokens,
        costUsd: estimateCost(model, promptTokens, completionTokens),
      },
      provider: this.providerName,
      model,
      latencyMs: Date.now() - start,
    };
  }
}

function estimatePromptTokens(messages: LLMMessage[], tools?: Array<{ name: string }>): number {
  let n = 0;
  for (const m of messages) n += Math.ceil(m.content.length / 4) + 8;
  if (tools) n += tools.length * 40;
  return n;
}

function estimateCompletionTokens(content: string | null, calls: LLMToolCall[]): number {
  let n = content ? Math.ceil(content.length / 4) + 8 : 0;
  for (const c of calls) n += JSON.stringify(c.arguments).length / 4 + 16;
  return Math.ceil(n);
}
