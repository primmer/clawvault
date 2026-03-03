/**
 * ClawVault Plugin v2 — In-Process Hybrid Retrieval Pipeline
 *
 * Replaces shell-out to qmd/semantic-rerank.mjs with proper TypeScript:
 *
 *  1. BM25 in-process (via natural library, fallback to qmd)
 *  2. Semantic search via @huggingface/transformers
 *  3. RRF fusion
 *  4. Optional cross-encoder rerank (Jina/Voyage/SiliconFlow/Pinecone)
 *  5. Recency boost + time decay
 *  6. Length normalization
 *  7. MMR diversity
 *  8. Scope filtering
 *
 * Falls back to qmd shell-out if in-process search fails.
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import type {
  QmdResult, ScoredResult, RetrievalConfig, MemoryScope,
} from './types.js';
import { DEFAULT_RETRIEVAL_CONFIG, matchesScope, parseScope } from './types.js';
import { parseYamlFrontmatter } from './templates.js';

// ─── BM25 In-Process ───────────────────────────────────────────────────────

interface BM25Document {
  id: string;
  file: string;
  title: string;
  content: string;
  modifiedAt: Date;
  scope: MemoryScope;
}

/**
 * Tokenize text for BM25 scoring.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * BM25 scoring against a document corpus.
 */
function bm25Search(
  query: string,
  documents: BM25Document[],
  topK: number,
): { id: string; score: number; doc: BM25Document }[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || documents.length === 0) return [];

  const k1 = 1.2;
  const b = 0.75;
  const N = documents.length;

  // Pre-compute document lengths and avg
  const docTokens = documents.map(d => tokenize(`${d.title} ${d.content}`));
  const avgDl = docTokens.reduce((sum, t) => sum + t.length, 0) / N;

  // Document frequency for each query term
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const tokens of docTokens) {
      if (tokens.includes(term)) count++;
    }
    df.set(term, count);
  }

  const results: { id: string; score: number; doc: BM25Document }[] = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const tokens = docTokens[i];
    const dl = tokens.length;
    let score = 0;

    // Count term frequencies
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    for (const term of queryTerms) {
      const termFreq = tf.get(term) || 0;
      if (termFreq === 0) continue;

      const docFreq = df.get(term) || 0;
      const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const tfNorm = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * dl / avgDl));
      score += idf * tfNorm;
    }

    if (score > 0) {
      results.push({ id: doc.id, score, doc });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// ─── Semantic Search ────────────────────────────────────────────────────────

let embeddingPipeline: unknown = null;
let pipelineLoading: Promise<unknown> | null = null;

async function getEmbeddingPipeline(): Promise<{
  (text: string, opts: { pooling: string; normalize: boolean }): Promise<{ data: Float64Array }>;
}> {
  if (embeddingPipeline) return embeddingPipeline as ReturnType<typeof getEmbeddingPipeline> extends Promise<infer T> ? T : never;
  if (pipelineLoading) return pipelineLoading as ReturnType<typeof getEmbeddingPipeline> extends Promise<infer T> ? T : never;

  pipelineLoading = (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'fp32',
    });
    return embeddingPipeline;
  })();

  return pipelineLoading as ReturnType<typeof getEmbeddingPipeline> extends Promise<infer T> ? T : never;
}

async function embed(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline();
  const result = await (pipe as (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>)(
    text, { pooling: 'mean', normalize: true },
  );
  return new Float32Array(result.data);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

// ─── Embedding Cache ────────────────────────────────────────────────────────

interface EmbeddingCacheData {
  [docId: string]: number[];
}

function loadEmbeddingCache(vaultPath: string): Map<string, Float32Array> {
  const cachePath = join(vaultPath, '.clawvault', 'embeddings.bin.json');
  const cache = new Map<string, Float32Array>();

  if (!existsSync(cachePath)) return cache;

  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf-8')) as EmbeddingCacheData;
    for (const [key, arr] of Object.entries(data)) {
      cache.set(key, new Float32Array(arr));
    }
  } catch {
    // Fresh cache
  }

  return cache;
}

async function semanticSearch(
  query: string,
  cache: Map<string, Float32Array>,
  topK: number,
): Promise<{ id: string; score: number }[]> {
  if (cache.size === 0) return [];

  const queryEmb = await embed(query);
  const results: { id: string; score: number }[] = [];

  for (const [id, docEmb] of cache.entries()) {
    results.push({ id, score: cosineSimilarity(queryEmb, docEmb) });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// ─── RRF Fusion ─────────────────────────────────────────────────────────────

function reciprocalRankFusion(
  list1: { id: string; score: number }[],
  list2: { id: string; score: number }[],
  k: number = 60,
  weight1: number = 0.5,
  weight2: number = 0.5,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();

  for (let rank = 0; rank < list1.length; rank++) {
    const { id } = list1[rank];
    scores.set(id, (scores.get(id) || 0) + weight1 / (k + rank + 1));
  }

  for (let rank = 0; rank < list2.length; rank++) {
    const { id } = list2[rank];
    scores.set(id, (scores.get(id) || 0) + weight2 / (k + rank + 1));
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// ─── Cross-Encoder Rerank ───────────────────────────────────────────────────

interface RerankResponse {
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
}

async function crossEncoderRerank(
  query: string,
  documents: string[],
  config: RetrievalConfig,
): Promise<number[] | null> {
  if (!config.rerankProvider || !config.rerankApiKey) return null;
  if (documents.length === 0) return null;

  const endpoints: Record<string, string> = {
    jina: 'https://api.jina.ai/v1/rerank',
    voyage: 'https://api.voyageai.com/v1/rerank',
    siliconflow: 'https://api.siliconflow.cn/v1/rerank',
    pinecone: 'https://api.pinecone.io/rerank',
  };

  const models: Record<string, string> = {
    jina: 'jina-reranker-v2-base-multilingual',
    voyage: 'rerank-2',
    siliconflow: 'BAAI/bge-reranker-v2-m3',
    pinecone: 'bge-reranker-v2-m3',
  };

  const endpoint = config.rerankEndpoint || endpoints[config.rerankProvider];
  const model = config.rerankModel || models[config.rerankProvider];

  if (!endpoint) return null;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.rerankApiKey}`,
      },
      body: JSON.stringify({
        model,
        query,
        documents,
        top_n: documents.length,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json() as RerankResponse;
    if (!data.results) return null;

    // Map back to original order
    const scores = new Array<number>(documents.length).fill(0);
    for (const result of data.results) {
      if (result.index >= 0 && result.index < documents.length) {
        scores[result.index] = result.relevance_score;
      }
    }

    return scores;
  } catch {
    return null; // Graceful degradation
  }
}

// ─── Scoring Functions ──────────────────────────────────────────────────────

/**
 * Recency boost: additive bonus based on how recent the document is.
 * Uses exponential decay with configurable half-life.
 */
export function computeRecencyBoost(
  modifiedAt: Date,
  now: Date,
  halfLifeDays: number,
  weight: number,
): number {
  if (halfLifeDays <= 0 || weight <= 0) return 0;
  const ageDays = (now.getTime() - modifiedAt.getTime()) / (1000 * 60 * 60 * 24);
  const decay = Math.exp(-ageDays * Math.LN2 / halfLifeDays);
  return weight * decay;
}

/**
 * Time decay: multiplicative penalty for old documents.
 * score *= 0.5 + 0.5 * exp(-ageDays / halfLife)
 */
export function computeTimeDecay(
  modifiedAt: Date,
  now: Date,
  halfLifeDays: number,
): number {
  if (halfLifeDays <= 0) return 1.0;
  const ageDays = (now.getTime() - modifiedAt.getTime()) / (1000 * 60 * 60 * 24);
  return 0.5 + 0.5 * Math.exp(-ageDays / halfLifeDays);
}

/**
 * Length normalization: shorter memories get a bonus, very long ones get penalized.
 * factor = 1 / (1 + log2(charLen / anchor))
 */
export function computeLengthNorm(charLen: number, anchor: number): number {
  if (anchor <= 0 || charLen <= 0) return 1.0;
  return 1 / (1 + Math.log2(Math.max(1, charLen / anchor)));
}

// ─── MMR Diversity ──────────────────────────────────────────────────────────

/**
 * Maximal Marginal Relevance: diversify results by penalizing similarity
 * to already-selected documents.
 */
function mmrRerank(
  results: ScoredResult[],
  embeddingCache: Map<string, Float32Array>,
  lambda: number,
  topK: number,
): ScoredResult[] {
  if (lambda >= 1.0 || results.length <= 1) return results.slice(0, topK);

  const selected: ScoredResult[] = [];
  const remaining = new Set(results.map((_, i) => i));

  // Always pick the top result first
  selected.push(results[0]);
  remaining.delete(0);

  while (selected.length < topK && remaining.size > 0) {
    let bestIdx = -1;
    let bestMmrScore = -Infinity;

    for (const idx of remaining) {
      const relevance = results[idx].fusedScore;

      // Compute max similarity to already-selected docs
      let maxSim = 0;
      const candidateId = results[idx].file?.replace(/^qmd:\/\/[^/]+\//, '').replace(/\.md$/, '') || '';
      const candidateEmb = embeddingCache.get(candidateId);

      if (candidateEmb) {
        for (const sel of selected) {
          const selId = sel.file?.replace(/^qmd:\/\/[^/]+\//, '').replace(/\.md$/, '') || '';
          const selEmb = embeddingCache.get(selId);
          if (selEmb) {
            maxSim = Math.max(maxSim, cosineSimilarity(candidateEmb, selEmb));
          }
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestIdx = idx;
      }
    }

    if (bestIdx >= 0) {
      selected.push(results[bestIdx]);
      remaining.delete(bestIdx);
    } else {
      break;
    }
  }

  return selected;
}

// ─── Vault Document Loading ─────────────────────────────────────────────────

function loadVaultDocuments(vaultPath: string): BM25Document[] {
  const documents: BM25Document[] = [];
  const dirsToScan = [
    'tasks', 'projects', 'decisions', 'people', 'persons',
    'notes', 'daily', 'journal', 'ledger', 'memory', 'memories',
    'observations', 'lessons',
  ];

  const scanDir = (dir: string) => {
    if (!existsSync(dir)) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          const depth = fullPath.replace(vaultPath, '').split('/').length;
          if (depth <= 3) scanDir(fullPath);
        } else if (entry.name.endsWith('.md')) {
          try {
            const stat = statSync(fullPath);
            const content = readFileSync(fullPath, 'utf-8');
            const parsed = parseYamlFrontmatter(content);
            const relPath = relative(vaultPath, fullPath);
            const docId = relPath.replace(/\.md$/, '');
            const title = parsed?.frontmatter?.title || parsed?.frontmatter?.summary || entry.name.replace(/\.md$/, '');
            const body = parsed?.body || content;
            const scope = parseScope(String(parsed?.frontmatter?.scope || 'global'));

            documents.push({
              id: docId,
              file: relPath,
              title: String(title),
              content: body.slice(0, 2000),
              modifiedAt: stat.mtime,
              scope,
            });
          } catch {
            // skip unreadable
          }
        }
      }
    } catch {
      // skip inaccessible dir
    }
  };

  // Scan root and known subdirectories
  scanDir(vaultPath);
  for (const subdir of dirsToScan) {
    const fullPath = join(vaultPath, subdir);
    if (existsSync(fullPath) && !documents.some(d => d.file.startsWith(subdir + '/'))) {
      scanDir(fullPath);
    }
  }

  return documents;
}

// ─── QMD Fallback ───────────────────────────────────────────────────────────

function qmdSearch(query: string, collection: string, limit: number): QmdResult[] {
  const sanitized = query.replace(/['']/g, ' ').replace(/[^\w\s\-.,?!]/g, ' ').trim();
  if (!sanitized) return [];

  let results: QmdResult[] = [];

  for (const cmd of ['query', 'search']) {
    try {
      const result = execFileSync('qmd', [
        cmd, sanitized, '-n', String(Math.max(limit * 2, 20)),
        '--json', '-c', collection,
      ], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
        timeout: cmd === 'query' ? 30000 : 15000,
      });
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed) && parsed.length > 0) {
        results = parsed as QmdResult[];
        break;
      }
    } catch (err: unknown) {
      const errObj = err as { stdout?: string };
      if (errObj.stdout) {
        try {
          const parsed = JSON.parse(errObj.stdout);
          if (Array.isArray(parsed) && parsed.length > 0) {
            results = parsed as QmdResult[];
            break;
          }
        } catch { /* ignore */ }
      }
    }
  }

  return results;
}

// ─── Main Retrieval Pipeline ────────────────────────────────────────────────

export interface RetrievalOptions {
  config?: Partial<RetrievalConfig>;
  scope?: MemoryScope;
  collection?: string;
  vaultPath: string;
}

/**
 * Full hybrid retrieval pipeline:
 * BM25 + Semantic -> RRF -> Rerank -> Recency/Decay/LengthNorm -> MMR
 */
export async function retrieve(
  query: string,
  options: RetrievalOptions,
): Promise<ScoredResult[]> {
  const config: RetrievalConfig = { ...DEFAULT_RETRIEVAL_CONFIG, ...options.config };
  const { vaultPath, collection = 'clawvault' } = options;
  const scope = options.scope || 'global';
  const now = new Date();

  let fusedResults: { id: string; score: number; doc?: BM25Document }[] = [];
  let usedInProcess = false;

  // ── Step 1: Try in-process BM25 + Semantic ────────────────────────────

  try {
    const documents = loadVaultDocuments(vaultPath);
    const embeddingCache = loadEmbeddingCache(vaultPath);

    // Scope filter
    const scopedDocs = scope === 'global'
      ? documents
      : documents.filter(d => matchesScope(d.scope, scope));

    if (scopedDocs.length > 0) {
      // BM25
      const bm25Results = bm25Search(query, scopedDocs, config.topK * 3);
      const bm25Ranked = bm25Results.map(r => ({ id: r.id, score: r.score }));

      // Semantic
      const semanticRanked = await semanticSearch(query, embeddingCache, config.topK * 3);

      // RRF fusion
      fusedResults = reciprocalRankFusion(
        bm25Ranked, semanticRanked,
        config.rrfK, config.bm25Weight, config.semanticWeight,
      ).map(r => {
        const doc = scopedDocs.find(d => d.id === r.id);
        return { ...r, doc };
      });

      usedInProcess = true;
    }
  } catch {
    // In-process failed — fall through to qmd
  }

  // ── Step 2: Fallback to qmd if in-process failed ──────────────────────

  if (!usedInProcess || fusedResults.length === 0) {
    const qmdResults = qmdSearch(query, collection, config.topK * 2);
    fusedResults = qmdResults.map((r, i) => ({
      id: (r.file || '').replace(`qmd://${collection}/`, '').replace(/\.md$/, ''),
      score: r.score ?? (1 / (i + 1)),
      qmd: r,
    }));
  }

  if (fusedResults.length === 0) return [];

  // ── Step 3: Build ScoredResult objects ────────────────────────────────

  let scored: ScoredResult[] = fusedResults.map(r => {
    const doc = (r as { doc?: BM25Document }).doc;
    const qmd = (r as { qmd?: QmdResult }).qmd;

    return {
      file: doc?.file || qmd?.file || r.id + '.md',
      title: doc?.title || qmd?.title || r.id,
      snippet: qmd?.snippet || doc?.content?.slice(0, 300) || '',
      score: r.score,
      fusedScore: r.score,
      scope: doc?.scope || 'global',
    };
  });

  // ── Step 4: Cross-encoder rerank (optional) ───────────────────────────

  if (config.rerankProvider && config.rerankApiKey) {
    const texts = scored.map(r => `${r.title || ''} ${r.snippet || ''}`.trim());
    const rerankScores = await crossEncoderRerank(query, texts, config);

    if (rerankScores) {
      scored = scored.map((r, i) => ({
        ...r,
        rerankScore: rerankScores[i],
        fusedScore: config.rerankWeight * rerankScores[i] +
                    (1 - config.rerankWeight) * r.fusedScore,
      }));
      scored.sort((a, b) => b.fusedScore - a.fusedScore);
    }
  }

  // ── Step 5: Recency boost + Time decay ────────────────────────────────

  scored = scored.map(r => {
    const doc = fusedResults.find(f => f.id === r.file?.replace(/\.md$/, ''));
    const modifiedAt = (doc as { doc?: BM25Document })?.doc?.modifiedAt;

    let recencyBoost = 0;
    let timeDecay = 1.0;

    if (modifiedAt) {
      recencyBoost = computeRecencyBoost(
        modifiedAt, now,
        config.recencyHalfLifeDays, config.recencyWeight,
      );
      timeDecay = computeTimeDecay(modifiedAt, now, config.decayHalfLifeDays);
    }

    return {
      ...r,
      recencyBoost,
      timeDecay,
      fusedScore: (r.fusedScore + recencyBoost) * timeDecay,
    };
  });

  // ── Step 6: Length normalization ───────────────────────────────────────

  if (config.lengthNormAnchor > 0) {
    scored = scored.map(r => {
      const charLen = (r.snippet?.length || 0) + (r.title?.length || 0);
      const lengthNorm = computeLengthNorm(charLen, config.lengthNormAnchor);
      return {
        ...r,
        lengthNorm,
        fusedScore: r.fusedScore * lengthNorm,
      };
    });
  }

  // Re-sort after all scoring adjustments
  scored.sort((a, b) => b.fusedScore - a.fusedScore);

  // ── Step 7: MMR diversity ─────────────────────────────────────────────

  if (config.mmrLambda < 1.0) {
    const embeddingCache = loadEmbeddingCache(vaultPath);
    scored = mmrRerank(scored, embeddingCache, config.mmrLambda, config.topK);
  }

  // ── Step 8: Apply min score threshold and limit ───────────────────────

  return scored
    .filter(r => r.fusedScore >= config.minScore)
    .slice(0, config.topK);
}

/**
 * Synchronous hybrid search using qmd (legacy compatibility).
 * Used when async retrieval isn't possible.
 */
export function qmdHybridSearch(
  query: string,
  collection: string,
  limit: number = 10,
): QmdResult[] {
  const sanitized = query.replace(/['']/g, ' ').replace(/[^\w\s\-.,?!]/g, ' ').trim();
  if (!sanitized) return [];

  const bm25Results = qmdSearch(sanitized, collection, limit);

  // Try semantic reranking via embedding cache
  try {
    const vaultPath = process.env.CLAWVAULT_PATH || join(
      process.env.HOME || '.', 'clawvault',
    );
    const cachePath = join(vaultPath, '.clawvault', 'embeddings.bin.json');

    if (bm25Results.length > 0 && existsSync(cachePath)) {
      // Use node child process for semantic rerank (sync fallback)
      const rerankerPath = join(__dirname, 'semantic-rerank.mjs');
      if (existsSync(rerankerPath)) {
        const reranked = execFileSync('node', [
          rerankerPath, sanitized, cachePath, JSON.stringify(bm25Results),
        ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
        const parsed = JSON.parse(reranked) as QmdResult[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.slice(0, limit);
        }
      }
    }
  } catch {
    // Semantic reranking failed — return BM25 results
  }

  return bm25Results.slice(0, limit);
}
