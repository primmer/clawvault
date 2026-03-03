/**
 * ClawVault Plugin v2 — Observer / Session Parser
 *
 * Extracts observations from conversation messages:
 * - Detects preferences, decisions, facts, tasks, lessons
 * - Classifies against template schemas
 * - Generates tags and categories
 */

import { classifyText } from './templates.js';
import { isNoise, type NoiseFilterConfig, DEFAULT_NOISE_CONFIG } from './noise-filter.js';
import type { Observation, ObservationResult, ObservationPattern } from './types.js';

// ─── Observability Check ────────────────────────────────────────────────────

/**
 * Check if text is worth observing (not system noise, not too short/long).
 */
export function isObservable(text: string, noiseConfig?: NoiseFilterConfig): boolean {
  if (!text || text.length < 20 || text.length > 5000) return false;
  // Delegate to noise filter for deeper checks
  const check = isNoise(text, noiseConfig ?? DEFAULT_NOISE_CONFIG);
  return !check.isNoise;
}

// ─── Observation Patterns ───────────────────────────────────────────────────

const OBSERVATION_PATTERNS: ObservationPattern[] = [
  // Preferences
  { pattern: /\b(i prefer|i like|i hate|i love|i want|i need|i always|i never|don't like|dont like)\b/i, weight: 2 },
  // Decisions
  { pattern: /\b(we decided|let's go with|we're going|i chose|we'll use|ship it|do it|go with)\b/i, weight: 2 },
  // Facts about people/things
  { pattern: /\b(my .+ is|his .+ is|her .+ is|their .+ is|works at|lives in|born in)\b/i, weight: 1.5 },
  // Contact info
  { pattern: /[\w.-]+@[\w.-]+\.\w+|\+\d{10,}/i, weight: 2 },
  // Explicit memory request
  { pattern: /\b(remember|don't forget|keep in mind|note that|important:)\b/i, weight: 2.5 },
  // Deadlines/dates
  { pattern: /\b(by tonight|by tomorrow|deadline|due date|by end of|ship by|ready by)\b/i, weight: 1.5 },
  // Lessons learned
  { pattern: /\b(i learned|we learned|lesson|realized|discovered|found out)\b/i, weight: 1.5 },
  // Tasks
  { pattern: /\b(need to|should|must|have to|todo|task)\b/i, weight: 1 },
  // Projects
  { pattern: /\b(working on|building|developing|project|initiative)\b/i, weight: 1 },
];

// ─── Observation Extraction ─────────────────────────────────────────────────

export function extractObservations(text: string): Observation[] {
  const observations: Observation[] = [];
  const sentences = splitIntoSentences(text);
  const now = new Date();

  for (const sentence of sentences) {
    if (sentence.length < 15) continue;

    let totalWeight = 0;
    for (const { pattern, weight } of OBSERVATION_PATTERNS) {
      if (pattern.test(sentence)) {
        totalWeight += weight;
      }
    }

    if (totalWeight < 1) continue;

    const classification = classifyText(sentence);
    const category = deriveCategoryFromPrimitive(classification.primitiveType, sentence);
    const tags = generateTags(classification, sentence);

    observations.push({
      text: sentence.trim(),
      primitiveType: classification.primitiveType,
      confidence: classification.confidence,
      matchedKeywords: classification.matchedKeywords,
      category,
      tags,
      extractedAt: now,
    });
  }

  return observations;
}

function splitIntoSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?\n])\s+/);
  return raw.map(s => s.trim()).filter(s => s.length > 0);
}

function deriveCategoryFromPrimitive(primitiveType: string, text: string): string {
  const lower = text.toLowerCase();

  if (primitiveType === 'memory_event') {
    if (/prefer|like|love|hate|want|need|always|never/i.test(lower)) return 'preference';
    if (/remember|don't forget|keep in mind|note that/i.test(lower)) return 'note';
    return 'fact';
  }

  const categoryMap: Record<string, string> = {
    person: 'entity',
    decision: 'decision',
    task: 'task',
    project: 'project',
    lesson: 'lesson',
    trigger: 'automation',
    run: 'execution',
    checkpoint: 'checkpoint',
    handoff: 'handoff',
    'daily-note': 'daily',
    daily: 'daily',
    party: 'entity',
    workspace: 'workspace',
  };

  return categoryMap[primitiveType] ?? 'fact';
}

function generateTags(classification: { primitiveType: string }, text: string): string[] {
  const tags = [classification.primitiveType];
  const lower = text.toLowerCase();

  if (/prefer|like|love/i.test(lower)) tags.push('positive');
  if (/hate|dislike|don't like/i.test(lower)) tags.push('negative');
  if (/deadline|due|by tomorrow|by tonight/i.test(lower)) tags.push('time-sensitive');
  if (/important|critical|urgent/i.test(lower)) tags.push('high-priority');
  if (/email|phone|contact/i.test(lower)) tags.push('contact-info');
  if (/decided|chose|approved/i.test(lower)) tags.push('finalized');
  if (/proposed|considering|might/i.test(lower)) tags.push('tentative');

  return [...new Set(tags)];
}

// ─── Message Processing ────────────────────────────────────────────────────

export function processMessageForObservations(
  content: string,
  _options: Record<string, unknown> = {},
): ObservationResult {
  if (!isObservable(content)) {
    return {
      observations: [],
      skipped: 1,
      reason: 'Content not observable',
    };
  }

  const observations = extractObservations(content);
  const maxObservations = 5;
  const limited = observations.slice(0, maxObservations);
  const skipped = observations.length - limited.length;

  return {
    observations: limited,
    skipped,
    reason: skipped > 0 ? `Limited to ${maxObservations} observations` : undefined,
  };
}

// ─── Category Detection ────────────────────────────────────────────────────

export function detectCategory(text: string): string {
  const classification = classifyText(text);
  return deriveCategoryFromPrimitive(classification.primitiveType, text);
}

// ─── Search Term Extraction ─────────────────────────────────────────────────

export function extractSearchTerms(input: string): string {
  const noise = /\b(hey|hi|hello|um|uh|like|just|so|well|you know|i mean|basically|actually|really|very|pretty|quite|how does it feel|how do you|can you|could you|would you|do you|what do you think|tell me about)\b/gi;
  let cleaned = input.replace(noise, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 5) cleaned = input.trim();
  return cleaned;
}
