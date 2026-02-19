/**
 * ClawVault SDK — Search module
 * 
 * Wraps qmd search/vsearch/query for BM25, semantic, and hybrid search.
 * Shell-out for now (v0.1), will migrate to in-process in v1.0.
 */

import { execFileSync } from 'node:child_process';
import type { SearchOptions, SearchResult, ClawVaultConfig } from './types.js';

/** Parse qmd JSON output into SearchResult array */
function parseQmdResults(output: string, collection: string): SearchResult[] {
  try {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r: any) => ({
      docId: r.docid || r.id || '',
      score: typeof r.score === 'number' ? r.score : 0,
      file: (r.file || '').replace(`qmd://${collection}/`, ''),
      title: r.title || '',
      snippet: (r.snippet || '')
        .replace(/@@ .+? @@\s*\(.+?\)\n?/g, '') // strip qmd diff headers
        .trim(),
      content: r.content,
    }));
  } catch {
    return [];
  }
}

/** Run a qmd command and return stdout */
function runQmd(
  args: string[],
  config: ClawVaultConfig,
): string {
  const bin = config.qmdBin || 'qmd';
  const timeout = config.timeout || 30_000;
  
  try {
    return execFileSync(bin, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    });
  } catch (err: any) {
    // Try parsing from stdout even on non-zero exit
    if (err?.stdout && typeof err.stdout === 'string') {
      return err.stdout;
    }
    throw new Error(`qmd command failed: ${err?.message || 'unknown error'}`);
  }
}

/**
 * Search the vault using BM25 keyword matching.
 */
export function searchBM25(
  query: string,
  config: ClawVaultConfig,
  options: SearchOptions = {},
): SearchResult[] {
  const collection = options.collection || config.collection || 'clawvault';
  const limit = options.limit || config.defaultLimit || 10;
  const sanitized = query.replace(/['']/g, ' ').replace(/[^\w\s\-.,?!]/g, ' ').trim();
  
  const output = runQmd(
    ['search', sanitized, '-n', String(limit), '--json', '-c', collection],
    config,
  );
  return parseQmdResults(output, collection);
}

/**
 * Search the vault using vector similarity (semantic search).
 */
export function searchSemantic(
  query: string,
  config: ClawVaultConfig,
  options: SearchOptions = {},
): SearchResult[] {
  const collection = options.collection || config.collection || 'clawvault';
  const limit = options.limit || config.defaultLimit || 10;
  const sanitized = query.replace(/['']/g, ' ').replace(/[^\w\s\-.,?!]/g, ' ').trim();
  
  const output = runQmd(
    ['vsearch', sanitized, '-n', String(limit), '--json', '-c', collection],
    config,
  );
  return parseQmdResults(output, collection);
}

/**
 * Search the vault using hybrid (BM25 + vector + reranking).
 * This is the recommended search method — combines keyword and semantic matching
 * with a reranking model for best results.
 * 
 * Falls back to BM25 if hybrid search fails.
 */
export function searchHybrid(
  query: string,
  config: ClawVaultConfig,
  options: SearchOptions = {},
): SearchResult[] {
  const collection = options.collection || config.collection || 'clawvault';
  const limit = options.limit || config.defaultLimit || 10;
  const sanitized = query.replace(/['']/g, ' ').replace(/[^\w\s\-.,?!]/g, ' ').trim();
  
  try {
    const output = runQmd(
      ['query', sanitized, '-n', String(limit), '--json', '-c', collection],
      config,
    );
    const results = parseQmdResults(output, collection);
    if (results.length > 0) return results;
  } catch {
    // Fall through to BM25 fallback
  }
  
  return searchBM25(query, config, options);
}

/**
 * Search the vault using the specified strategy.
 * Default: hybrid (BM25 + vector + reranking).
 */
export function search(
  query: string,
  config: ClawVaultConfig,
  options: SearchOptions = {},
): SearchResult[] {
  const strategy = options.strategy || config.defaultStrategy || 'hybrid';
  
  switch (strategy) {
    case 'bm25':
      return searchBM25(query, config, options);
    case 'semantic':
      return searchSemantic(query, config, options);
    case 'hybrid':
    default:
      return searchHybrid(query, config, options);
  }
}
