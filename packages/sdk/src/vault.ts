/**
 * ClawVault SDK — Main VaultClient class
 * 
 * The primary entry point for interacting with a ClawVault vault.
 * Wraps all SDK modules into a single convenient API.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type {
  ClawVaultConfig,
  SearchOptions,
  SearchResult,
  ObserveOptions,
  ObserveResult,
  ContextOptions,
  ContextResult,
  VaultStatus,
} from './types.js';
import { search, searchBM25, searchSemantic, searchHybrid } from './search.js';
import { observe } from './observe.js';
import { context } from './context.js';

/** Resolve vault path from config, env, or defaults */
function resolveVaultPath(path?: string): string {
  if (path) return path;
  if (process.env.CLAWVAULT_PATH) return process.env.CLAWVAULT_PATH;
  
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  const candidates = [
    join(home, 'clawvault'),
    join(home, '.clawvault'),
  ];
  
  for (const candidate of candidates) {
    if (existsSync(join(candidate, '.clawvault.json'))) return candidate;
  }
  
  return join(home, '.clawvault');
}

/** Read vault config from .clawvault.json */
function readVaultConfig(vaultPath: string): any {
  try {
    const configPath = join(vaultPath, '.clawvault.json');
    if (!existsSync(configPath)) return null;
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * ClawVault client — the main SDK entry point.
 * 
 * @example
 * ```typescript
 * import { ClawVault } from '@clawvault/sdk';
 * 
 * const vault = new ClawVault({ path: '~/clawvault' });
 * 
 * // Search with hybrid retrieval
 * const results = vault.search('user preference for dark mode');
 * 
 * // Observe new information
 * vault.observe('User prefers dark mode in all apps', { tags: ['preference'] });
 * 
 * // Get context for injection
 * const ctx = vault.context({ maxChars: 5000 });
 * ```
 */
export class ClawVault {
  readonly config: ClawVaultConfig;
  private vaultConfig: any;

  constructor(options: Partial<ClawVaultConfig> = {}) {
    const vaultPath = resolveVaultPath(options.path);
    this.vaultConfig = readVaultConfig(vaultPath);
    
    this.config = {
      path: vaultPath,
      collection: options.collection || this.vaultConfig?.qmdCollection || this.vaultConfig?.name || 'clawvault',
      defaultStrategy: options.defaultStrategy || 'hybrid',
      defaultLimit: options.defaultLimit || 10,
      qmdBin: options.qmdBin || 'qmd',
      clawvaultBin: options.clawvaultBin || 'clawvault',
      timeout: options.timeout || 30_000,
    };
  }

  /**
   * Search the vault using the configured strategy.
   * Default: hybrid (BM25 + vector + reranking).
   */
  search(query: string, options?: SearchOptions): SearchResult[] {
    return search(query, this.config, options);
  }

  /** BM25 keyword search */
  searchBM25(query: string, options?: SearchOptions): SearchResult[] {
    return searchBM25(query, this.config, options);
  }

  /** Vector similarity search */
  searchSemantic(query: string, options?: SearchOptions): SearchResult[] {
    return searchSemantic(query, this.config, options);
  }

  /** Hybrid search (BM25 + vector + reranking) */
  searchHybrid(query: string, options?: SearchOptions): SearchResult[] {
    return searchHybrid(query, this.config, options);
  }

  /**
   * Write an observation to the vault.
   * Goes through compression, entity extraction, and indexing.
   */
  observe(content: string, options?: ObserveOptions): ObserveResult {
    return observe(content, this.config, options);
  }

  /**
   * Retrieve context for agent session injection.
   * Combines recent observations, vault knowledge, and preferences.
   */
  context(options?: ContextOptions): ContextResult {
    return context(this.config, options);
  }

  /**
   * Get vault status information.
   */
  status(): VaultStatus {
    const bin = this.config.qmdBin || 'qmd';
    let documentCount = 0;
    let vectorCount = 0;
    let lastUpdated = '';

    try {
      const output = execFileSync(bin, ['status'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });
      
      const totalMatch = output.match(/Total:\s+(\d+)/);
      if (totalMatch) documentCount = parseInt(totalMatch[1], 10);
      
      const vectorMatch = output.match(/Vectors:\s+(\d+)/);
      if (vectorMatch) vectorCount = parseInt(vectorMatch[1], 10);
      
      const updatedMatch = output.match(/Updated:\s+(.+)/);
      if (updatedMatch) lastUpdated = updatedMatch[1].trim();
    } catch {
      // Best-effort status
    }

    return {
      path: this.config.path,
      name: this.vaultConfig?.name || 'unknown',
      collection: this.config.collection || 'clawvault',
      documentCount,
      vectorCount,
      categories: this.vaultConfig?.categories || [],
      lastUpdated,
    };
  }
}
