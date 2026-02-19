/**
 * Dynamic Observation Engine for ClawVault
 *
 * Replaces hardcoded categories with template-driven classification.
 * Extracts observations from text and classifies them against the
 * template registry using keyword/heuristic matching (no LLM calls).
 */

import { classifyText, getSchema, type ClassificationResult } from './templates.js';

// ============================================================================
// Types
// ============================================================================

export interface Observation {
  text: string;
  primitiveType: string;
  confidence: number;
  matchedKeywords: string[];
  category: string;
  tags: string[];
  extractedAt: Date;
}

export interface ObservationResult {
  observations: Observation[];
  skipped: number;
  reason?: string;
}

// ============================================================================
// Content Filtering
// ============================================================================

export function isObservable(text: string): boolean {
  if (!text || text.length < 20 || text.length > 5000) return false;
  if (text.includes('<relevant-memories>')) return false;
  if (text.startsWith('[System')) return false;
  if (text.includes('HEARTBEAT')) return false;
  if (text.startsWith('NO_REPLY')) return false;
  // Skip tool call results and JSON blobs
  if (text.startsWith('{') && text.includes('"')) return false;
  // Skip markdown-heavy agent output (likely formatted responses, not facts)
  const markdownDensity = (text.match(/[#*`\-|>]/g) || []).length / text.length;
  if (markdownDensity > 0.15) return false;

  return true;
}

// ============================================================================
// Observation Extraction
// ============================================================================

const OBSERVATION_PATTERNS = [
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

export function extractObservations(text: string): Observation[] {
  const observations: Observation[] = [];
  const sentences = splitIntoSentences(text);
  const now = new Date();

  for (const sentence of sentences) {
    if (sentence.length < 15) continue;

    // Check if sentence matches any observation pattern
    let totalWeight = 0;
    for (const { pattern, weight } of OBSERVATION_PATTERNS) {
      if (pattern.test(sentence)) {
        totalWeight += weight;
      }
    }

    // Only extract if sentence has sufficient signal
    if (totalWeight < 1) continue;

    // Classify against template registry
    const classification = classifyText(sentence);

    // Derive category from primitive type
    const category = deriveCategoryFromPrimitive(classification.primitiveType, sentence);

    // Generate tags
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
  // Split on sentence boundaries while preserving meaningful chunks
  const raw = text.split(/(?<=[.!?\n])\s+/);
  const sentences: string[] = [];

  for (const s of raw) {
    const trimmed = s.trim();
    if (trimmed.length > 0) {
      sentences.push(trimmed);
    }
  }

  return sentences;
}

function deriveCategoryFromPrimitive(primitiveType: string, text: string): string {
  const lower = text.toLowerCase();

  // Special handling for memory_event - determine sub-category
  if (primitiveType === 'memory_event') {
    if (/prefer|like|love|hate|want|need|always|never/i.test(lower)) {
      return 'preference';
    }
    if (/remember|don't forget|keep in mind|note that/i.test(lower)) {
      return 'note';
    }
    return 'fact';
  }

  // Map primitive types to categories
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

function generateTags(classification: ClassificationResult, text: string): string[] {
  const tags: string[] = [classification.primitiveType];
  const lower = text.toLowerCase();

  // Add category-specific tags
  if (/prefer|like|love/i.test(lower)) tags.push('positive');
  if (/hate|dislike|don't like/i.test(lower)) tags.push('negative');
  if (/deadline|due|by tomorrow|by tonight/i.test(lower)) tags.push('time-sensitive');
  if (/important|critical|urgent/i.test(lower)) tags.push('high-priority');
  if (/email|phone|contact/i.test(lower)) tags.push('contact-info');
  if (/decided|chose|approved/i.test(lower)) tags.push('finalized');
  if (/proposed|considering|might/i.test(lower)) tags.push('tentative');

  return [...new Set(tags)];
}

// ============================================================================
// Batch Processing
// ============================================================================

export function processMessageForObservations(
  content: string,
  options: { from?: string; sessionId?: string } = {}
): ObservationResult {
  if (!isObservable(content)) {
    return {
      observations: [],
      skipped: 1,
      reason: 'Content not observable',
    };
  }

  const observations = extractObservations(content);

  // Limit to prevent flooding
  const maxObservations = 5;
  const limited = observations.slice(0, maxObservations);
  const skipped = observations.length - limited.length;

  return {
    observations: limited,
    skipped,
    reason: skipped > 0 ? `Limited to ${maxObservations} observations` : undefined,
  };
}

// ============================================================================
// Legacy Category Detection (for backward compatibility)
// ============================================================================

export function detectCategory(text: string): string {
  const classification = classifyText(text);
  return deriveCategoryFromPrimitive(classification.primitiveType, text);
}

// ============================================================================
// Preference-Specific Extraction
// ============================================================================

export interface ExtractedPreference {
  category: string;
  item: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  source: string;
}

export function extractPreferences(text: string): ExtractedPreference[] {
  const preferences: ExtractedPreference[] = [];

  const patterns = [
    { regex: /i (?:really )?(?:like|love|enjoy|prefer)\s+(.+?)(?:\.|,|$)/gi, sentiment: 'positive' as const },
    { regex: /i (?:don't|do not|hate|dislike)\s+(.+?)(?:\.|,|$)/gi, sentiment: 'negative' as const },
    { regex: /my favorite\s+(.+?)\s+is\s+(.+?)(?:\.|,|$)/gi, sentiment: 'positive' as const, hasCategory: true },
    { regex: /i prefer\s+(.+?)\s+over\s+(.+?)(?:\.|,|$)/gi, sentiment: 'positive' as const },
  ];

  for (const { regex, sentiment, hasCategory } of patterns) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      if (hasCategory && match[2]) {
        preferences.push({
          category: normalizeCategory(match[1]),
          item: match[2].trim(),
          sentiment,
          confidence: 0.8,
          source: text.slice(0, 100),
        });
      } else if (match[1]) {
        const item = match[1].trim();
        preferences.push({
          category: inferCategory(item),
          item,
          sentiment,
          confidence: 0.7,
          source: text.slice(0, 100),
        });
      }
    }
  }

  return preferences;
}

function normalizeCategory(category: string): string {
  return category.toLowerCase().trim().replace(/\s+/g, '_');
}

function inferCategory(item: string): string {
  const itemLower = item.toLowerCase();

  const categoryKeywords: Record<string, string[]> = {
    food: ['pizza', 'coffee', 'tea', 'food', 'restaurant', 'cuisine', 'dish', 'meal', 'drink'],
    technology: ['programming', 'code', 'software', 'app', 'technology', 'framework', 'language', 'tool'],
    entertainment: ['movie', 'music', 'book', 'game', 'show', 'series', 'film', 'song', 'album'],
    work: ['meeting', 'project', 'task', 'deadline', 'team', 'client'],
    communication: ['email', 'slack', 'chat', 'call', 'message'],
  };

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(k => itemLower.includes(k))) {
      return category;
    }
  }

  return 'general';
}

// ============================================================================
// Search Term Extraction
// ============================================================================

export function extractSearchTerms(input: string): string {
  // Remove common conversational noise
  const noise = /\b(hey|hi|hello|um|uh|like|just|so|well|you know|i mean|basically|actually|really|very|pretty|quite|how does it feel|how do you|can you|could you|would you|do you|what do you think|tell me about)\b/gi;
  let cleaned = input.replace(noise, ' ').replace(/\s+/g, ' ').trim();

  // If we stripped too much, fall back to original
  if (cleaned.length < 5) cleaned = input.trim();

  return cleaned;
}
