/**
 * Emergency rule engine. Runs BEFORE any LLM call. Deterministic, auditable,
 * and unit-tested. These rules are the safety floor: if one matches, the
 * conversation is handed to a human immediately — model judgment never
 * overrides it.
 */

export interface EmergencyMatch {
  matchedTerm: string;
  category: string;
  reason: string;
}

export interface EmergencyResult {
  isEmergency: boolean;
  matches: EmergencyMatch[];
}

/** Default rules: {regex, category, reason}. Tenant keywords are appended. */
const DEFAULT_RULES: Array<{ re: RegExp; category: string; reason: string }> = [
  { re: /\bgas\s*leak\b/i, category: 'plumbing', reason: 'Gas leak — possible CO/asphyxiation hazard' },
  { re: /\bsmell\w*\s+gas\b|\bgas\s+smell\b/i, category: 'plumbing', reason: 'Gas odor reported' },
  { re: /\bburst(?:ing)?\s+pipe\b|\bpipe\s+burst(?:ing)?\b/i, category: 'plumbing', reason: 'Burst pipe — active water damage' },
  { re: /\bflood(ing|ed)?\b/i, category: 'plumbing', reason: 'Flooding in progress' },
  { re: /\bno\s+heat\b|\bheat\s+is\s+out\b|\bheating\s+broken\b/i, category: 'hvac', reason: 'No heat — habitability risk' },
  { re: /\bno\s+hot\s+water\b/i, category: 'plumbing', reason: 'No hot water — habitability risk' },
  { re: /\bno\s+water\b|\bwater\s+is\s+off\b/i, category: 'plumbing', reason: 'Water completely off' },
  { re: /\btoilet\s+not\s+working\b|\btoilet\s+(clogged|overflow|overflo)/i, category: 'plumbing', reason: 'Only toilet non-functional' },
  { re: /\bsewage\s*back(up|flow)\b|\braw\s+sewage\b/i, category: 'plumbing', reason: 'Sewage backup — biohazard' },
  { re: /\b(electrical\s+fire|smoke|sparks?|burning\s+smell)\b/i, category: 'electrical', reason: 'Fire/smoke/sparks risk' },
  { re: /\bfire\b/i, category: 'other', reason: 'Fire reported' },
  { re: /\block(?:ed|s)?\s+out\b|\blockout\b|\bstuck\s+(in|outside)\b|\bbaby\s+(in|locked)\b/i, category: 'lock', reason: 'Lockout / child locked in' },
  { re: /\bleak\b[\s\S]*\bceiling\b|\bceiling\b[\s\S]*\b(leak|collaps)/i, category: 'structural', reason: 'Ceiling leak/collapse' },
  { re: /\bno\s+(working\s+)?toilet\b/i, category: 'plumbing', reason: 'No functioning toilet' },
];

/** If an emergency match is made but we want to double check: strong signal threshold. */
export function detectEmergency(text: string, extraKeywords: string[] = []): EmergencyResult {
  const matches: EmergencyMatch[] = [];

  for (const rule of DEFAULT_RULES) {
    const m = text.match(rule.re);
    if (m && m[0]) {
      matches.push({ matchedTerm: m[0], category: rule.category, reason: rule.reason });
    }
  }

  for (const kw of extraKeywords) {
    const normalized = kw.toLowerCase().trim();
    if (!normalized) continue;
    if (text.toLowerCase().includes(normalized)) {
      matches.push({
        matchedTerm: normalized,
        category: 'other',
        reason: `Tenant-configured emergency keyword: "${kw}"`,
      });
    }
  }

  return { isEmergency: matches.length > 0, matches };
}

/** Message used by the agent when handing an emergency to a human. */
export function emergencyEscalationMessage(matches: EmergencyMatch[]): string {
  const top = matches[0];
  return `URGENT — ${top?.reason ?? 'Emergency'}. Matched: "${top?.matchedTerm}". This has been routed to the on-call team.`;
}
