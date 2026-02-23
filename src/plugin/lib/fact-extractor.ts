export interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  sourceText: string;
  extractedAt: string;
}

interface FactPattern {
  regex: RegExp;
  defaultPredicate: string;
  confidence: number;
  subjectGroup: number;
  objectGroup: number;
  predicateGroup?: number;
}

const PRONOUN_ENTITY_MAP: Record<string, string> = {
  i: 'user',
  me: 'user',
  my: 'user',
  mine: 'user',
  we: 'user',
  us: 'user',
  our: 'user',
  ours: 'user'
};

const STOP_ENTITIES = new Set([
  'it',
  'that',
  'this',
  'there',
  'something',
  'anything'
]);

const FACT_PATTERNS: FactPattern[] = [
  {
    regex: /\b([a-zA-Z0-9][a-zA-Z0-9\s'._-]{0,80}?)\s+(is|are|was|were)\s+(?!based in\b|located in\b)([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})/gi,
    defaultPredicate: 'is',
    confidence: 0.72,
    subjectGroup: 1,
    objectGroup: 3,
    predicateGroup: 2
  },
  {
    regex: /\b([a-zA-Z0-9][a-zA-Z0-9\s'._-]{0,80}?)\s+(?:is|are)\s+(based in|located in)\s+([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})/gi,
    defaultPredicate: 'lives_in',
    confidence: 0.84,
    subjectGroup: 1,
    objectGroup: 3,
    predicateGroup: 2
  },
  {
    regex: /\b([a-zA-Z0-9][a-zA-Z0-9\s'._-]{0,80}?)\s+(work at|work for|works at|works for|employed by)\s+([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})/gi,
    defaultPredicate: 'works_at',
    confidence: 0.85,
    subjectGroup: 1,
    objectGroup: 3,
    predicateGroup: 2
  },
  {
    regex: /\b([a-zA-Z0-9][a-zA-Z0-9\s'._-]{0,80}?)\s+(likes|loves|enjoys|prefers|hates|dislikes)\s+([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})/gi,
    defaultPredicate: 'likes',
    confidence: 0.75,
    subjectGroup: 1,
    objectGroup: 3,
    predicateGroup: 2
  },
  {
    regex: /\b([a-zA-Z0-9][a-zA-Z0-9\s'._-]{0,80}?)\s+(live in|lives in|based in|located in)\s+([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})/gi,
    defaultPredicate: 'lives_in',
    confidence: 0.84,
    subjectGroup: 1,
    objectGroup: 3,
    predicateGroup: 2
  },
  {
    regex: /\b([a-zA-Z0-9][a-zA-Z0-9\s'._-]{0,80}?)\s+(created|built|founded|started)\s+([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})/gi,
    defaultPredicate: 'created',
    confidence: 0.8,
    subjectGroup: 1,
    objectGroup: 3,
    predicateGroup: 2
  },
  {
    regex: /\b([a-zA-Z0-9][a-zA-Z0-9\s'._-]{0,80}?)\s+(use|uses|used|using)\s+([a-zA-Z0-9][a-zA-Z0-9\s'._-]{1,120})/gi,
    defaultPredicate: 'uses',
    confidence: 0.73,
    subjectGroup: 1,
    objectGroup: 3,
    predicateGroup: 2
  }
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeEdgePunctuation(value: string): string {
  return value
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/[^a-zA-Z0-9)\]'"`]+$/, '')
    .trim();
}

function normalizeEntity(raw: string): string {
  const trimmed = sanitizeEdgePunctuation(normalizeWhitespace(raw));
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  if (PRONOUN_ENTITY_MAP[lower]) {
    return PRONOUN_ENTITY_MAP[lower];
  }

  return trimmed.replace(/^(?:the|a|an)\s+/i, '').trim();
}

function normalizePredicate(raw: string): string {
  const value = normalizeWhitespace(raw).toLowerCase();
  if (value === 'is' || value === 'are' || value === 'was' || value === 'were') return 'is';
  if (value === 'work at' || value === 'work for' || value === 'works at' || value === 'works for' || value === 'employed by') return 'works_at';
  if (value === 'likes' || value === 'loves' || value === 'enjoys' || value === 'prefers') return 'likes';
  if (value === 'hates' || value === 'dislikes') return 'dislikes';
  if (value === 'live in' || value === 'lives in' || value === 'based in' || value === 'located in') return 'lives_in';
  if (value === 'created' || value === 'built' || value === 'founded' || value === 'started') return 'created';
  if (value === 'use' || value === 'uses' || value === 'used' || value === 'using') return 'uses';
  return value.replace(/\s+/g, '_');
}

function isInformativeEntity(value: string): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  if (STOP_ENTITIES.has(lower)) return false;
  return value.length > 1;
}

function splitIntoSentences(text: string): string[] {
  const compact = normalizeWhitespace(text);
  if (!compact) return [];

  const matches = compact.match(/[^.!?\n]+[.!?]?/g);
  if (!matches) return [compact];
  return matches.map((entry) => entry.trim()).filter(Boolean);
}

function buildFactKey(subject: string, predicate: string, object: string): string {
  return `${subject.toLowerCase()}|${predicate.toLowerCase()}|${object.toLowerCase()}`;
}

function extractFromSentence(sentence: string, extractedAt: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();

  for (const pattern of FACT_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(sentence)) !== null) {
      const subjectRaw = match[pattern.subjectGroup] ?? '';
      const objectRaw = match[pattern.objectGroup] ?? '';
      const predicateRaw = pattern.predicateGroup ? (match[pattern.predicateGroup] ?? pattern.defaultPredicate) : pattern.defaultPredicate;

      const subject = normalizeEntity(subjectRaw);
      const object = normalizeEntity(objectRaw);
      const predicate = normalizePredicate(predicateRaw || pattern.defaultPredicate);

      if (!isInformativeEntity(subject) || !isInformativeEntity(object) || !predicate) {
        continue;
      }

      const key = buildFactKey(subject, predicate, object);
      if (seen.has(key)) continue;
      seen.add(key);

      facts.push({
        subject,
        predicate,
        object,
        confidence: pattern.confidence,
        sourceText: sentence,
        extractedAt
      });
    }
  }

  return facts;
}

export function extractFactsRuleBased(input: string | string[]): ExtractedFact[] {
  const texts = Array.isArray(input) ? input : [input];
  const extractedAt = new Date().toISOString();
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    for (const sentence of splitIntoSentences(text)) {
      const sentenceFacts = extractFromSentence(sentence, extractedAt);
      for (const fact of sentenceFacts) {
        const key = buildFactKey(fact.subject, fact.predicate, fact.object);
        if (seen.has(key)) continue;
        seen.add(key);
        facts.push(fact);
      }
    }
  }

  return facts;
}
