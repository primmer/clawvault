/**
 * ClawVault Search Engine - qmd Backend
 * Uses qmd CLI for BM25 and vector search
 *
 * v2.7.0 enhancements:
 *   1. Chunk-level BM25 pre-filtering (from eval v4 adapter)
 *   2. Exhaustive threshold-based retrieval (from eval v6 adapter)
 *   3. Preference extraction pipeline (from eval v3 adapter)
 *   4. Temporal date indexing at ingest time (from eval v8 design)
 */

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Document, SearchResult, SearchOptions, ExtractedDate, ExtractedPreference } from '../types.js';
import { isSuperseded } from './reweave.js';

export const QMD_INSTALL_URL = 'https://github.com/tobi/qmd';
export const QMD_INSTALL_COMMAND = 'bun install -g github:tobi/qmd';
const QMD_NOT_INSTALLED_MESSAGE = `ClawVault requires qmd. Install: ${QMD_INSTALL_COMMAND}`;
export const QMD_INDEX_ENV_VAR = 'CLAWVAULT_QMD_INDEX';

export class QmdUnavailableError extends Error {
  constructor(message: string = QMD_NOT_INSTALLED_MESSAGE) {
    super(message);
    this.name = 'QmdUnavailableError';
  }
}

/**
 * QMD search result format
 */
interface QmdResult {
  docid: string;
  score: number;
  file: string;
  title: string;
  snippet: string;
}

function ensureJsonArgs(args: string[]): string[] {
  return args.includes('--json') ? args : [...args, '--json'];
}

export function resolveQmdIndexName(indexName?: string): string | undefined {
  const explicit = indexName?.trim();
  if (explicit) {
    return explicit;
  }

  const fromEnv = process.env[QMD_INDEX_ENV_VAR]?.trim();
  return fromEnv || undefined;
}

export function withQmdIndexArgs(args: string[], indexName?: string): string[] {
  if (args.includes('--index')) {
    return [...args];
  }

  const resolvedIndexName = resolveQmdIndexName(indexName);
  if (!resolvedIndexName) {
    return [...args];
  }

  return ['--index', resolvedIndexName, ...args];
}

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractJsonPayload(raw: string): string | null {
  const start = raw.search(/[\[{]/);
  if (start === -1) return null;
  const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
  if (end <= start) return null;
  return raw.slice(start, end + 1);
}

/**
 * Strip non-JSON noise from qmd stdout (e.g. node-llama-cpp fallback
 * warnings, query expansion progress lines, and tree-drawing characters).
 * These appear before the JSON payload on systems without GPU support or
 * during first-run model downloads and break JSON.parse.
 */
function stripQmdNoise(raw: string): string {
  return raw
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return true;
      if (t.startsWith('[node-llama-cpp]')) return false;
      if (t.startsWith('Expanding query')) return false;
      if (t.startsWith('Searching ') && t.endsWith('queries...')) return false;
      if (/^[├└─│]/.test(t)) return false;
      return true;
    })
    .join('\n');
}

function parseQmdOutput(raw: string): QmdResult[] {
  const trimmed = stripQmdNoise(raw).trim();
  if (!trimmed) return [];

  const direct = tryParseJson(trimmed);
  const extracted = direct ? null : extractJsonPayload(trimmed);
  const parsed = direct ?? (extracted ? tryParseJson(extracted) : null);

  if (!parsed) {
    throw new Error('qmd returned non-JSON output. Ensure qmd supports --json.');
  }

  if (Array.isArray(parsed)) {
    return parsed as QmdResult[];
  }

  if (parsed && typeof parsed === 'object') {
    const candidate = (parsed as { results?: unknown; items?: unknown; data?: unknown; }).results
      ?? (parsed as { results?: unknown; items?: unknown; data?: unknown; }).items
      ?? (parsed as { results?: unknown; items?: unknown; data?: unknown; }).data;

    if (Array.isArray(candidate)) {
      return candidate as QmdResult[];
    }
  }

  throw new Error('qmd returned an unexpected JSON shape.');
}

function ensureQmdAvailable(): void {
  if (!hasQmd()) {
    throw new QmdUnavailableError();
  }
}

/**
 * Execute qmd command and return parsed JSON
 */
function execQmd(args: string[], indexName?: string): QmdResult[] {
  ensureQmdAvailable();
  const finalArgs = withQmdIndexArgs(ensureJsonArgs(args), indexName);

  try {
    const result = execFileSync('qmd', finalArgs, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024 // 10MB
    });

    return parseQmdOutput(result);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new QmdUnavailableError();
    }

    const output = [err?.stdout, err?.stderr].filter(Boolean).join('\n');
    if (output) {
      try {
        return parseQmdOutput(output);
      } catch {
        // Fall through to throw a helpful error
      }
    }

    const message = err?.message ? `qmd failed: ${err.message}` : 'qmd failed';
    throw new Error(message);
  }
}

/**
 * Check if qmd is available
 */
export function hasQmd(): boolean {
  const result = spawnSync('qmd', ['--version'], { stdio: 'ignore' });
  return !result.error;
}

/**
 * Trigger qmd update (reindex)
 */
export function qmdUpdate(collection?: string, indexName?: string): void {
  ensureQmdAvailable();
  const args = ['update'];
  if (collection) {
    args.push('-c', collection);
  }
  execFileSync('qmd', withQmdIndexArgs(args, indexName), { stdio: 'inherit' });
}

/**
 * Trigger qmd embed (create/update vector embeddings)
 */
export function qmdEmbed(collection?: string, indexName?: string): void {
  ensureQmdAvailable();
  const args = ['embed'];
  if (collection) {
    args.push('-c', collection);
  }
  execFileSync('qmd', withQmdIndexArgs(args, indexName), { stdio: 'inherit' });
}

// ---------------------------------------------------------------------------
// v2.7 — Chunk-level BM25 pre-filtering helpers (ported from eval v4 adapter)
// ---------------------------------------------------------------------------

/**
 * Split text into ~maxChars sentence-aligned chunks with overlap.
 */
export function sentenceChunk(
  text: string,
  maxChars = 600,
  overlapSentences = 1,
): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return text.trim() ? [text] : [];

  const chunks: string[] = [];
  let i = 0;
  while (i < sentences.length) {
    const chunkSents: string[] = [];
    let chunkLen = 0;
    let j = i;
    while (j < sentences.length && chunkLen + sentences[j].length < maxChars) {
      chunkSents.push(sentences[j]);
      chunkLen += sentences[j].length + 1;
      j++;
    }
    if (chunkSents.length === 0) {
      chunkSents.push(sentences[j].slice(0, maxChars));
      j++;
    }
    chunks.push(chunkSents.join(' '));
    i = Math.max(j - overlapSentences, i + 1);
  }
  return chunks;
}

const STOPWORDS = new Set([
  'what','when','where','which','that','this','have','from','with',
  'they','been','were','will','about','would','could','should','their',
  'there','does','your','more','some','than','into','also','just','very',
  'much','most','many','only','other','each','every','after','before',
  'did','the','and','for','are','was','not','but','can','had','has',
  'how','who','why','its','you','my','me','is','it','do','so','if',
  'or','an','on','at','by','no','up','to','in','of','am','be',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/^[?.,!"'\-():;[\]{}*]+|[?.,!"'\-():;[\]{}*]+$/g, ''))
    .filter(w => w.length > 1);
}

function queryTerms(query: string): string[] {
  return tokenize(query).filter(w => !STOPWORDS.has(w));
}

/**
 * BM25-rank chunks within a document by keyword overlap.
 * Returns the top `max` chunks sorted by relevance, always including the
 * first chunk (session context) when available.
 */
export function bm25RankChunks(
  chunks: string[],
  terms: string[],
  max = 5,
): { text: string; score: number }[] {
  if (chunks.length === 0) return [];
  const termSet = new Set(terms);
  const scored = chunks.map((text, idx) => {
    const words = new Set(tokenize(text));
    let overlap = 0;
    for (const t of termSet) if (words.has(t)) overlap++;
    return { text, score: overlap, idx };
  });
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set<number>();
  const result: { text: string; score: number }[] = [];
  // Always include first chunk for context
  seen.add(0);
  result.push({ text: chunks[0], score: scored.find(s => s.idx === 0)?.score ?? 0 });
  for (const s of scored) {
    if (result.length >= max) break;
    if (!seen.has(s.idx) && s.score > 0) {
      seen.add(s.idx);
      result.push({ text: s.text, score: s.score });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// v2.7 — Temporal date extraction at ingest time (ported from eval v8 design)
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_RE_PART = Object.keys(MONTH_NAMES).join('|');

// ISO: 2024-01-15  or  2024/01/15
const DATE_ISO_RE = /\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/g;
// US: 01/15/2024
const DATE_US_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
// "January 15, 2024"
const DATE_MONTH_DAY_YEAR_RE = new RegExp(
  `\\b(${MONTH_RE_PART})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})\\b`, 'gi');
// "15 January 2024"
const DATE_DAY_MONTH_YEAR_RE = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE_PART}),?\\s*(\\d{4})\\b`, 'gi');
// "January 15" (no year)
const DATE_MONTH_DAY_RE = new RegExp(
  `\\b(${MONTH_RE_PART})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi');
// "3 days ago"
const RELATIVE_AGO_RE = /\b(\d+)\s+(days?|weeks?|months?|years?)\s+ago\b/gi;
// "in 3 days"
const RELATIVE_IN_RE = /\bin\s+(\d+)\s+(days?|weeks?|months?|years?)\b/gi;
// Duration: "for 3 days", "took 5 hours"
const DURATION_RE = /(?:for|took|spent|lasted|about|approximately|around)\s+(\d+)\s+(days?|weeks?|months?|years?|hours?|minutes?)/gi;

function tryParseISODate(y: number, m: number, d: number): Date | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) return dt;
  return null;
}

function unitToDays(n: number, unit: string): number | null {
  const u = unit.toLowerCase().replace(/s$/, '');
  switch (u) {
    case 'day': return n;
    case 'week': return n * 7;
    case 'month': return n * 30;
    case 'year': return n * 365;
    default: return null;
  }
}

function contextSnippet(text: string, start: number, end: number, maxLen = 150): string {
  const s = Math.max(0, start - Math.floor(maxLen / 2));
  const e = Math.min(text.length, end + Math.floor(maxLen / 2));
  return text.slice(s, e).replace(/\n/g, ' ').trim();
}

function isoStr(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Extract all date references from text content. Designed to run at ingest
 * time so temporal queries can use structured dates + JS arithmetic instead
 * of relying on LLM date math at query time.
 */
export function extractDates(text: string, sessionDateStr?: string): ExtractedDate[] {
  const results: ExtractedDate[] = [];
  const sessionDate = sessionDateStr ? new Date(sessionDateStr) : null;

  // Helper to push, deduplicating by date+context
  const seen = new Set<string>();
  function push(date: string, ctx: string, docId = '') {
    const key = `${date}|${ctx.slice(0, 60)}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ date, context: ctx, documentId: docId });
  }

  // ISO dates
  for (const m of text.matchAll(DATE_ISO_RE)) {
    const dt = tryParseISODate(+m[1], +m[2], +m[3]);
    if (dt) push(isoStr(dt), contextSnippet(text, m.index!, m.index! + m[0].length));
  }
  // US dates
  for (const m of text.matchAll(DATE_US_RE)) {
    const dt = tryParseISODate(+m[3], +m[1], +m[2]);
    if (dt) push(isoStr(dt), contextSnippet(text, m.index!, m.index! + m[0].length));
  }
  // "January 15, 2024"
  for (const m of text.matchAll(DATE_MONTH_DAY_YEAR_RE)) {
    const mon = MONTH_NAMES[m[1].toLowerCase()];
    if (mon) {
      const dt = tryParseISODate(+m[3], mon, +m[2]);
      if (dt) push(isoStr(dt), contextSnippet(text, m.index!, m.index! + m[0].length));
    }
  }
  // "15 January 2024"
  for (const m of text.matchAll(DATE_DAY_MONTH_YEAR_RE)) {
    const mon = MONTH_NAMES[m[2].toLowerCase()];
    if (mon) {
      const dt = tryParseISODate(+m[3], mon, +m[1]);
      if (dt) push(isoStr(dt), contextSnippet(text, m.index!, m.index! + m[0].length));
    }
  }
  // "January 15" (no year — infer from session date)
  if (sessionDate) {
    for (const m of text.matchAll(DATE_MONTH_DAY_RE)) {
      const mon = MONTH_NAMES[m[1].toLowerCase()];
      if (mon) {
        const dt = tryParseISODate(sessionDate.getFullYear(), mon, +m[2]);
        if (dt) push(isoStr(dt), contextSnippet(text, m.index!, m.index! + m[0].length));
      }
    }
  }
  // Relative dates
  if (sessionDate) {
    for (const m of text.matchAll(RELATIVE_AGO_RE)) {
      const days = unitToDays(+m[1], m[2]);
      if (days !== null) {
        const dt = new Date(sessionDate.getTime() - days * 86400000);
        push(isoStr(dt), contextSnippet(text, m.index!, m.index! + m[0].length));
      }
    }
    for (const m of text.matchAll(RELATIVE_IN_RE)) {
      const days = unitToDays(+m[1], m[2]);
      if (days !== null) {
        const dt = new Date(sessionDate.getTime() + days * 86400000);
        push(isoStr(dt), contextSnippet(text, m.index!, m.index! + m[0].length));
      }
    }
  }
  // Durations
  for (const m of text.matchAll(DURATION_RE)) {
    push(`duration:${m[1]} ${m[2]}`, contextSnippet(text, m.index!, m.index! + m[0].length));
  }

  return results;
}

// ---------------------------------------------------------------------------
// v2.7 — Preference extraction at ingest time (ported from eval v3 adapter)
// ---------------------------------------------------------------------------

/** Regex patterns that indicate a user preference in conversation text. */
const PREF_PATTERNS = [
  // "I use/prefer/like/love/enjoy X"
  /\bi\s+(?:use|prefer|like|love|enjoy|favor|chose|switched to|started using|always use|usually use)\s+(.{3,60}?)(?:[.,;!?\n]|$)/gi,
  // "my favorite X is Y"
  /\bmy\s+(?:favorite|preferred|go-to|usual)\s+\w+\s+(?:is|are|was)\s+(.{3,60}?)(?:[.,;!?\n]|$)/gi,
  // "I'm a big fan of X"
  /\bi(?:'m| am)\s+(?:a )?(?:big |huge )?fan of\s+(.{3,60}?)(?:[.,;!?\n]|$)/gi,
  // "I switched from X to Y"
  /\bi\s+switched\s+from\s+(.{3,40}?)\s+to\s+(.{3,40}?)(?:[.,;!?\n]|$)/gi,
];

/**
 * Extract user preferences from conversation text. Runs at ingest time to
 * build a structured preference index for personalised recommendations.
 */
export function extractPreferences(text: string, documentId = ''): ExtractedPreference[] {
  const results: ExtractedPreference[] = [];
  const seen = new Set<string>();

  for (const pattern of PREF_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const value = (m[1] || '').trim();
      if (!value || value.length < 3) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Heuristic category from surrounding text
      const ctx = contextSnippet(text, m.index!, m.index! + m[0].length, 200);
      let category = 'general';
      if (/tool|software|app|editor|ide|framework|library|language/i.test(ctx)) category = 'tool';
      else if (/hobby|sport|exercise|game|play/i.test(ctx)) category = 'hobby';
      else if (/brand|product|model|device|hardware/i.test(ctx)) category = 'brand';
      else if (/food|drink|restaurant|cuisine|recipe/i.test(ctx)) category = 'food';
      else if (/music|movie|show|book|podcast|artist|band/i.test(ctx)) category = 'entertainment';

      results.push({ category, value, documentId, context: ctx });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// v2.7 — Question-type detection (ported from eval adapters v4/v6/v8)
// ---------------------------------------------------------------------------

const PREFERENCE_Q_RE = /(?:can you (?:recommend|suggest)|any (?:tips|advice|suggestions|recommendations)|what .*(?:recommend|suggest)|what should i|where should i|which .* should i|please (?:recommend|suggest)|based on .* (?:interest|preference|taste)|personalized|tailored to (?:my|me))/i;

const TEMPORAL_Q_RE = /(?:how many (?:days|weeks|months|years|hours|minutes) (?:passed|did|have|ago|between|since|in total|took)|how long (?:did|was|were|have|has|does)|how long ago|what (?:is the )?order|in order|which .* (?:first|last|earlier|later|before|after|most recent|oldest|newest)|chronological|(?:earlier|later|sooner|newer|older) than)/i;

const AGGREGATION_Q_RE = /(?:how many|how much|total|all the|count|list all|every|what are all|name all)/i;

export function classifyQuestion(q: string): 'preference' | 'temporal' | 'aggregation' | 'default' {
  if (PREFERENCE_Q_RE.test(q)) return 'preference';
  if (TEMPORAL_Q_RE.test(q)) return 'temporal';
  if (!TEMPORAL_Q_RE.test(q) && AGGREGATION_Q_RE.test(q)) return 'aggregation';
  return 'default';
}

// ---------------------------------------------------------------------------

/**
 * QMD Search Engine - wraps qmd CLI
 */
export class SearchEngine {
  private documents: Map<string, Document> = new Map();
  private collection: string = 'clawvault';
  private vaultPath: string = '';
  private collectionRoot: string = '';
  private qmdIndexName?: string;

  /** v2.7 — Per-document date index built at ingest time */
  private dateIndex: Map<string, ExtractedDate[]> = new Map();
  /** v2.7 — Per-document preference index built at ingest time */
  private preferenceIndex: Map<string, ExtractedPreference[]> = new Map();
  /** v2.7 — Per-document chunk cache for BM25 pre-filtering */
  private chunkCache: Map<string, string[]> = new Map();

  /**
   * Set the collection name (usually vault name)
   */
  setCollection(name: string): void {
    this.collection = name;
  }

  /**
   * Set the vault path for file resolution
   */
  setVaultPath(vaultPath: string): void {
    this.vaultPath = vaultPath;
  }

  /**
   * Set the collection root for qmd:// URI resolution
   */
  setCollectionRoot(root: string): void {
    this.collectionRoot = path.resolve(root);
  }

  /**
   * Set qmd index name (defaults to qmd global default when omitted)
   */
  setIndexName(indexName?: string): void {
    this.qmdIndexName = indexName;
  }

  /**
   * Add or update a document in the local cache.
   * v2.7: also extracts dates, preferences, and chunks at ingest time.
   * Note: qmd indexing happens via qmd update command
   */
  addDocument(doc: Document): void {
    this.documents.set(doc.id, doc);

    // v2.7 — temporal date indexing at ingest time
    if (doc.content) {
      const sessionDate = doc.modified ? isoStr(doc.modified) : undefined;
      const dates = extractDates(doc.content, sessionDate);
      for (const d of dates) d.documentId = doc.id;
      if (dates.length > 0) this.dateIndex.set(doc.id, dates);

      // v2.7 — preference extraction at ingest time
      const prefs = extractPreferences(doc.content, doc.id);
      if (prefs.length > 0) this.preferenceIndex.set(doc.id, prefs);

      // v2.7 — chunk cache for BM25 pre-filtering
      const chunks = sentenceChunk(doc.content, 600, 1);
      if (chunks.length > 0) this.chunkCache.set(doc.id, chunks);
    }
  }

  /**
   * Remove a document from the local cache
   */
  removeDocument(id: string): void {
    this.documents.delete(id);
    this.dateIndex.delete(id);
    this.preferenceIndex.delete(id);
    this.chunkCache.delete(id);
  }

  /**
   * No-op for qmd - indexing is managed externally
   */
  rebuildIDF(): void {
    // qmd handles this
  }

  /**
   * BM25 search via qmd
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    return this.runQmdQuery('search', query, options);
  }

  /**
   * Vector/semantic search via qmd vsearch
   */
  vsearch(query: string, options: SearchOptions = {}): SearchResult[] {
    return this.runQmdQuery('vsearch', query, options);
  }

  /**
   * Combined search with query expansion (qmd query command)
   */
  query(query: string, options: SearchOptions = {}): SearchResult[] {
    return this.runQmdQuery('query', query, options);
  }

  private runQmdQuery(command: 'search' | 'vsearch' | 'query', query: string, options: SearchOptions): SearchResult[] {
    const {
      limit = 10,
      minScore = 0,
      category,
      tags,
      fullContent = false,
      temporalBoost = false,
      relevanceThreshold,
      thresholdMaxResults = 40,
    } = options;

    if (!query.trim()) return [];

    // v2.7 — when relevanceThreshold is set, fetch a larger candidate set
    const fetchLimit = relevanceThreshold !== undefined
      ? thresholdMaxResults * 2
      : limit * 2;

    const args = [
      command,
      query,
      '-n', String(fetchLimit),
      '--json'
    ];

    if (this.collection) {
      args.push('-c', this.collection);
    }

    const qmdResults = execQmd(args, this.qmdIndexName);

    // v2.7 — threshold-based filtering: keep results while score > threshold
    const effectiveLimit = relevanceThreshold !== undefined ? thresholdMaxResults : limit;

    const results = this.convertResults(qmdResults, {
      limit: effectiveLimit,
      minScore: relevanceThreshold !== undefined ? relevanceThreshold : minScore,
      category,
      tags,
      fullContent,
      temporalBoost
    });

    return results;
  }

  // -------------------------------------------------------------------------
  // v2.7 — New public APIs
  // -------------------------------------------------------------------------

  /**
   * v2.7 — Chunk-level BM25 pre-filtered search. Ranks chunks within each
   * document by keyword relevance before semantic ranking, so relevant
   * content deep in long documents isn't missed.
   *
   * Returns results with snippets from the best-matching chunks.
   */
  chunkPrefilterSearch(query: string, options: SearchOptions = {}): SearchResult[] {
    const terms = queryTerms(query);
    const results = this.runQmdQuery('query', query, options);

    // Enrich snippets with best-matching chunks
    for (const r of results) {
      const chunks = this.chunkCache.get(r.document.id);
      if (chunks && chunks.length > 0 && terms.length > 0) {
        const ranked = bm25RankChunks(chunks, terms, 3);
        if (ranked.length > 0 && ranked[0].score > 0) {
          r.snippet = ranked.map(c => c.text).join('\n...\n').slice(0, 600);
        }
      }
    }
    return results;
  }

  /**
   * v2.7 — Exhaustive threshold-based search for aggregation queries.
   * Keeps pulling results until relevance drops below threshold.
   */
  exhaustiveSearch(query: string, threshold = 0.01, maxResults = 40): SearchResult[] {
    return this.runQmdQuery('query', query, {
      relevanceThreshold: threshold,
      thresholdMaxResults: maxResults,
      fullContent: false,
    });
  }

  /**
   * v2.7 — Get all extracted dates, optionally filtered by document ids.
   */
  getDates(documentIds?: string[]): ExtractedDate[] {
    const all: ExtractedDate[] = [];
    const iter = documentIds
      ? documentIds.map(id => [id, this.dateIndex.get(id)] as const).filter(([, v]) => v)
      : this.dateIndex.entries();
    for (const [, dates] of iter) {
      if (dates) all.push(...dates);
    }
    return all;
  }

  /**
   * v2.7 — Get all extracted preferences, optionally filtered by document ids.
   */
  getPreferences(documentIds?: string[]): ExtractedPreference[] {
    const all: ExtractedPreference[] = [];
    const iter = documentIds
      ? documentIds.map(id => [id, this.preferenceIndex.get(id)] as const).filter(([, v]) => v)
      : this.preferenceIndex.entries();
    for (const [, prefs] of iter) {
      if (prefs) all.push(...prefs);
    }
    return all;
  }

  /**
   * v2.7 — Search with automatic strategy selection based on question type.
   * Classifies the query and routes to the appropriate pipeline.
   */
  smartQuery(query: string, options: SearchOptions = {}): SearchResult[] {
    const qtype = classifyQuestion(query);
    switch (qtype) {
      case 'aggregation':
        return this.exhaustiveSearch(query, 0.01, options.thresholdMaxResults ?? 40);
      case 'preference':
      case 'temporal':
      default:
        // Use chunk pre-filter for all non-aggregation queries for better recall
        return this.chunkPrefilterSearch(query, { ...options, limit: options.limit ?? 10 });
    }
  }

  /**
   * Convert qmd results to ClawVault SearchResult format
   */
  private convertResults(
    qmdResults: QmdResult[], 
    options: SearchOptions
  ): SearchResult[] {
    const { limit = 10, minScore = 0, category, tags, fullContent = false, temporalBoost = false } = options;
    
    const results: SearchResult[] = [];
    
    // Normalize scores - qmd uses different scales
    const maxScore = qmdResults[0]?.score || 1;
    
    for (const qr of qmdResults) {
      // Extract file path from qmd:// URI
      const filePath = this.qmdUriToPath(qr.file);
      const relativePath = this.vaultPath 
        ? path.relative(this.vaultPath, filePath)
        : filePath;
      const normalizedRelativePath = relativePath.replace(/\\/g, '/');
      if (
        normalizedRelativePath.startsWith('ledger/archive/')
        || normalizedRelativePath.includes('/ledger/archive/')
      ) {
        continue;
      }
      
      // Get document from cache or create minimal one
      const docId = normalizedRelativePath.replace(/\.md$/, '');
      let doc = this.documents.get(docId)
        ?? this.documents.get(docId.split('/').join(path.sep));
      const modifiedAt = this.resolveModifiedAt(doc, filePath);
      
      // Determine category from path
      const parts = normalizedRelativePath.split('/');
      const docCategory = parts.length > 1 ? parts[0] : 'root';
      
      // Apply category filter
      if (category && docCategory !== category) continue;
      
      // Apply tag filter (only if we have the document cached)
      if (tags && tags.length > 0 && doc) {
        const docTags = new Set(doc.tags);
        if (!tags.some(t => docTags.has(t))) continue;
      }
      
      // Normalize score to 0-1 range
      const normalizedScore = maxScore > 0 ? qr.score / maxScore : 0;
      const finalScore = temporalBoost
        ? normalizedScore * this.getRecencyFactor(modifiedAt)
        : normalizedScore;
      
      // Apply min score filter
      if (finalScore < minScore) continue;
      
      // Create document if not cached
      if (!doc) {
        doc = {
          id: docId,
          path: filePath,
          category: docCategory,
          title: qr.title || path.basename(relativePath, '.md'),
          content: '', // Content loaded separately if needed
          frontmatter: {},
          links: [],
          tags: [],
          modified: modifiedAt
        };
      }
      
      results.push({
        document: fullContent ? doc : { ...doc, content: '' },
        score: finalScore,
        snippet: this.stripSupersededFromSnippet(this.cleanSnippet(qr.snippet)),
        matchedTerms: [] // qmd doesn't provide this
      });
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private resolveModifiedAt(doc: Document | undefined, filePath: string): Date {
    if (doc) return doc.modified;
    try {
      return fs.statSync(filePath).mtime;
    } catch {
      return new Date(0);
    }
  }

  private getRecencyFactor(modifiedAt: Date): number {
    const ageMs = Math.max(0, Date.now() - modifiedAt.getTime());
    const ageDays = ageMs / (24 * 60 * 60 * 1000);

    if (ageDays < 1) return 1.0;
    if (ageDays <= 7) return 0.9;
    return 0.7;
  }

  /**
   * Convert qmd:// URI to file path
   */
  private qmdUriToPath(uri: string): string {
    // qmd://collection/path/to/file.md -> actual path
    if (uri.startsWith('qmd://')) {
      const withoutScheme = uri.slice(6); // Remove 'qmd://'
      const slashIndex = withoutScheme.indexOf('/');
      if (slashIndex > -1) {
        // Get collection name and relative path
        const relativePath = withoutScheme.slice(slashIndex + 1);

        const root = this.collectionRoot || this.vaultPath;
        if (root) {
          return path.join(root, relativePath);
        }

        return relativePath;
      }
    }
    
    // Return as-is if not a qmd:// URI
    return uri;
  }

  /**
   * v2.8 — Filter superseded observation lines from snippet text.
   * Ensures search results prefer the latest version of knowledge.
   */
  private stripSupersededFromSnippet(snippet: string): string {
    if (!snippet) return snippet;
    return snippet
      .split('\n')
      .filter(line => !isSuperseded(line))
      .join('\n');
  }

  /**
   * Clean up qmd snippet format
   */
  private cleanSnippet(snippet: string): string {
    if (!snippet) return '';
    
    // Remove diff-style markers like "@@ -2,4 @@ (1 before, 67 after)"
    return snippet
      .replace(/@@ [-+]?\d+,?\d* @@ \([^)]+\)/g, '')
      .trim()
      .split('\n')
      .slice(0, 3)
      .join('\n')
      .slice(0, 300);
  }

  /**
   * Get all cached documents
   */
  getAllDocuments(): Document[] {
    return [...this.documents.values()];
  }

  /**
   * Get document count
   */
  get size(): number {
    return this.documents.size;
  }

  /**
   * Clear the local document cache and all v2.7 indices
   */
  clear(): void {
    this.documents.clear();
    this.dateIndex.clear();
    this.preferenceIndex.clear();
    this.chunkCache.clear();
  }

  /**
   * Export documents for persistence
   */
  export(): { documents: Document[]; } {
    return {
      documents: [...this.documents.values()]
    };
  }

  /**
   * Import from persisted data
   */
  import(data: { documents: Document[]; }): void {
    this.clear();
    for (const doc of data.documents) {
      this.addDocument(doc);
    }
  }
}

/**
 * Find wiki-links in content
 */
export function extractWikiLinks(content: string): string[] {
  const matches = content.match(/\[\[([^\]]+)\]\]/g) || [];
  return matches.map(m => m.slice(2, -2).toLowerCase());
}

/**
 * Find tags in content (#tag format)
 */
export function extractTags(content: string): string[] {
  const matches = content.match(/#[\w-]+/g) || [];
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))];
}
