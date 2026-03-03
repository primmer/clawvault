/**
 * ClawVault Plugin v2 — Noise Filter
 *
 * Filters low-quality content on both write and read paths:
 * - Refusals ("I can't help with that")
 * - Meta-questions ("How does it feel to be an AI?")
 * - Greetings ("Hello!", "Hi there")
 * - Low-information content (too short, too repetitive)
 * - System noise (heartbeats, tool calls, JSON blobs)
 */

// ─── Refusal patterns ───────────────────────────────────────────────────────

const REFUSAL_PATTERNS: RegExp[] = [
  /\b(i can'?t help with|i'?m not able to|i cannot|i'?m unable to|as an ai|i don'?t have the ability)\b/i,
  /\b(i'?m sorry,?\s+(?:but )?i|unfortunately,?\s+i (?:can'?t|cannot))\b/i,
  /\b(that'?s (?:beyond|outside) my|i'?m not (?:designed|programmed) to)\b/i,
  /\b(i (?:must |need to )?(?:decline|refuse)|i won'?t be able to)\b/i,
];

// ─── Meta-question patterns ─────────────────────────────────────────────────

const META_PATTERNS: RegExp[] = [
  /\b(how does it feel|what'?s it like being|are you (?:sentient|conscious|alive|real))\b/i,
  /\b(do you have (?:feelings|emotions|consciousness|a soul))\b/i,
  /\b(what are you|who made you|who created you|what model are you)\b/i,
  /\b(can you think|do you dream|are you aware)\b/i,
];

// ─── Greeting patterns ─────────────────────────────────────────────────────

const GREETING_PATTERNS: RegExp[] = [
  /^(?:hi|hello|hey|howdy|greetings|good (?:morning|afternoon|evening)|what'?s up|sup|yo)\s*[!.?]?\s*$/i,
  /^(?:thanks?|thank you|thx|ty|cheers)\s*[!.?]?\s*$/i,
  /^(?:ok|okay|sure|got it|understood|perfect|great|cool|nice|awesome)\s*[!.?]?\s*$/i,
  /^(?:bye|goodbye|see you|later|gn|good night|cya)\s*[!.?]?\s*$/i,
];

// ─── Low-information patterns ───────────────────────────────────────────────

const LOW_INFO_PATTERNS: RegExp[] = [
  /^[!?.]+$/,               // Just punctuation
  /^[\p{Emoji}\s]+$/u,      // Emoji-only
  /^(?:yes|no|maybe|idk|hmm|hm|ah|oh|uh|um|lol|lmao|haha|heh)\s*[!.?]*$/i,
];

// ─── System noise patterns ──────────────────────────────────────────────────

const SYSTEM_NOISE_PATTERNS: RegExp[] = [
  /^(?:\[System|HEARTBEAT|NO_REPLY)/,
  /^<(?:relevant-memories|session-recap|user-preferences)/,
  /^\s*\{[\s\S]*"(?:type|action|tool_use)"[\s\S]*\}\s*$/,  // JSON tool calls
];

export interface NoiseFilterConfig {
  enabled: boolean;
  minLength: number;
  maxLength: number;
}

export const DEFAULT_NOISE_CONFIG: NoiseFilterConfig = {
  enabled: true,
  minLength: 15,
  maxLength: 5000,
};

export type NoiseCategory = 'refusal' | 'meta' | 'greeting' | 'low_info' | 'system' | 'length';

export interface NoiseCheckResult {
  isNoise: boolean;
  category?: NoiseCategory;
  reason?: string;
}

/**
 * Check if text is noise that should be filtered.
 */
export function isNoise(text: string, config: NoiseFilterConfig = DEFAULT_NOISE_CONFIG): NoiseCheckResult {
  if (!config.enabled) return { isNoise: false };
  if (!text) return { isNoise: true, category: 'length', reason: 'Empty text' };

  const trimmed = text.trim();

  // Length checks
  if (trimmed.length < config.minLength) {
    return { isNoise: true, category: 'length', reason: `Too short (${trimmed.length} < ${config.minLength})` };
  }
  if (trimmed.length > config.maxLength) {
    return { isNoise: true, category: 'length', reason: `Too long (${trimmed.length} > ${config.maxLength})` };
  }

  // System noise (check first — fast path for common cases)
  for (const pattern of SYSTEM_NOISE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isNoise: true, category: 'system', reason: 'System noise' };
    }
  }

  // Greetings
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isNoise: true, category: 'greeting', reason: 'Greeting/acknowledgment' };
    }
  }

  // Low-info
  for (const pattern of LOW_INFO_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isNoise: true, category: 'low_info', reason: 'Low information content' };
    }
  }

  // Refusals
  for (const pattern of REFUSAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isNoise: true, category: 'refusal', reason: 'AI refusal' };
    }
  }

  // Meta-questions
  for (const pattern of META_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isNoise: true, category: 'meta', reason: 'Meta-question about AI' };
    }
  }

  // Markdown density check (code blocks, tables, etc.)
  const markdownChars = (trimmed.match(/[#*`\-|>]/g) || []).length;
  if (markdownChars / trimmed.length > 0.15) {
    return { isNoise: true, category: 'system', reason: 'High markdown density (likely code/formatting)' };
  }

  return { isNoise: false };
}

/**
 * Filter an array of texts, returning only non-noise items.
 */
export function filterNoise<T extends { text?: string; content?: string; snippet?: string }>(
  items: T[],
  config: NoiseFilterConfig = DEFAULT_NOISE_CONFIG,
): T[] {
  return items.filter(item => {
    const text = item.text || item.content || item.snippet || '';
    return !isNoise(text, config).isNoise;
  });
}
