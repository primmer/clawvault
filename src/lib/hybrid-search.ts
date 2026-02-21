/**
 * ClawVault Hybrid Search — BM25 + Semantic Embeddings + RRF
 * 
 * Proven in LongMemEval benchmarks:
 * - v28 pipeline: 57.0% overall (up from 52.6% with BM25-only)
 * - Multi-session: 45.9% (up from 28.6%)
 * - Single-session-user: 85.7% (up from 72.9%)
 * 
 * Architecture:
 * 1. BM25 via existing qmd search
 * 2. Semantic via @huggingface/transformers (all-MiniLM-L6-v2)
 * 3. Reciprocal Rank Fusion (k=60)
 */

import * as fs from 'fs';
import * as path from 'path';
import { SearchResult, SearchOptions, Document } from '../types.js';

// Lazy-loaded embedding pipeline
let embeddingPipeline: any = null;
let pipelineLoading: Promise<any> | null = null;

/**
 * Get or initialize the embedding pipeline (lazy singleton)
 */
async function getEmbeddingPipeline() {
  if (embeddingPipeline) return embeddingPipeline;
  if (pipelineLoading) return pipelineLoading;
  
  pipelineLoading = (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'fp32',
    });
    return embeddingPipeline;
  })();
  
  return pipelineLoading;
}

/**
 * Compute embedding for a text string
 */
export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline();
  const result = await pipe(text, { pooling: 'mean', normalize: true });
  return new Float32Array(result.data);
}

/**
 * Compute embeddings for multiple texts
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getEmbeddingPipeline();
  const results: Float32Array[] = [];
  // Process in small batches to avoid OOM
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    for (const text of batch) {
      const result = await pipe(text, { pooling: 'mean', normalize: true });
      results.push(new Float32Array(result.data));
    }
  }
  return results;
}

/**
 * Cosine similarity between two normalized vectors
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Embedding cache — stores embeddings on disk alongside vault files
 */
export class EmbeddingCache {
  private cachePath: string;
  private cache: Map<string, Float32Array> = new Map();
  private dirty = false;

  constructor(vaultPath: string) {
    this.cachePath = path.join(vaultPath, '.clawvault', 'embeddings.bin');
  }

  /**
   * Load cache from disk
   */
  load(): void {
    try {
      if (!fs.existsSync(this.cachePath)) return;
      const data = JSON.parse(fs.readFileSync(this.cachePath + '.json', 'utf-8'));
      for (const [key, arr] of Object.entries(data)) {
        this.cache.set(key, new Float32Array(arr as number[]));
      }
    } catch {
      // Fresh cache
    }
  }

  /**
   * Save cache to disk
   */
  save(): void {
    if (!this.dirty) return;
    const dir = path.dirname(this.cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: Record<string, number[]> = {};
    for (const [key, arr] of this.cache.entries()) {
      data[key] = Array.from(arr);
    }
    fs.writeFileSync(this.cachePath + '.json', JSON.stringify(data));
    this.dirty = false;
  }

  get(key: string): Float32Array | undefined {
    return this.cache.get(key);
  }

  set(key: string, embedding: Float32Array): void {
    this.cache.set(key, embedding);
    this.dirty = true;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  entries(): IterableIterator<[string, Float32Array]> {
    return this.cache.entries();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * Reciprocal Rank Fusion of two ranked lists
 */
export function reciprocalRankFusion(
  list1: { id: string; score: number }[],
  list2: { id: string; score: number }[],
  k: number = 60
): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  
  for (let rank = 0; rank < list1.length; rank++) {
    const { id } = list1[rank];
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
  }
  
  for (let rank = 0; rank < list2.length; rank++) {
    const { id } = list2[rank];
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
  }
  
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Semantic search against embedding cache
 */
export async function semanticSearch(
  query: string,
  cache: EmbeddingCache,
  topK: number = 20
): Promise<{ id: string; score: number }[]> {
  const queryEmb = await embed(query);
  
  const results: { id: string; score: number }[] = [];
  for (const [id, docEmb] of cache.entries()) {
    results.push({ id, score: cosineSimilarity(queryEmb, docEmb) });
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Hybrid search: combines BM25 results with semantic results via RRF
 */
export async function hybridSearch(
  query: string,
  bm25Results: SearchResult[],
  cache: EmbeddingCache,
  options: { topK?: number; rrfK?: number } = {}
): Promise<SearchResult[]> {
  const { topK = 20, rrfK = 60 } = options;
  
  // Convert BM25 results to ranked list using document path as ID
  const bm25Ranked = bm25Results.map(r => ({ id: r.document.path || r.document.id, score: r.score }));
  
  // Get semantic results
  const semanticRanked = await semanticSearch(query, cache, topK);
  
  // Fuse
  const fused = reciprocalRankFusion(bm25Ranked, semanticRanked, rrfK);
  
  // Map back to SearchResult format
  const bm25Map = new Map(bm25Results.map(r => [r.document.path || r.document.id, r]));
  
  return fused.slice(0, topK).map(({ id, score }) => {
    const existing = bm25Map.get(id);
    if (existing) {
      return { ...existing, score };
    }
    // Result only from semantic search — minimal result
    const minimalDoc: Document = {
      id: id.replace(/\.md$/, ''),
      path: id.endsWith('.md') ? id : id + '.md',
      title: (id.split('/').pop() || id).replace(/\.md$/, ''),
      content: '',
      category: id.split('/')[0] || 'root',
      frontmatter: {},
      links: [],
      tags: [],
      modified: new Date(),
    };
    return {
      document: minimalDoc,
      score,
      snippet: '',
      matchedTerms: [],
    } satisfies SearchResult;
  });
}
