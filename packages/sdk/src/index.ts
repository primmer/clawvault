/**
 * @clawvault/sdk — Programmatic API for ClawVault
 *
 * @example
 * ```typescript
 * import { createVault } from '@clawvault/sdk';
 * const vault = createVault('/path/to/vault');
 * const results = await vault.search('memory management');
 * ```
 */

import {
  ClawVault,
  SearchEngine,
  extractPreferences,
  buildContext,
  loadMemoryGraphIndex,
} from 'clawvault';

import type {
  SearchResult,
  SearchOptions,
  ExtractedPreference,
  Document,
  ContextOptions,
  ContextResult,
  MemoryGraphNode,
  MemoryGraphEdge,
  MemoryGraphIndex,
} from 'clawvault';

// Re-export types for consumers
export type {
  SearchResult,
  SearchOptions,
  ExtractedPreference,
  Document,
  ContextOptions,
  ContextResult,
  MemoryGraphNode,
  MemoryGraphEdge,
  VaultConfig,
  VaultMeta,
  StoreOptions,
  Category,
  MemoryType,
  ExtractedDate,
} from 'clawvault';

/* ------------------------------------------------------------------ */
/*  Graph sub-object                                                   */
/* ------------------------------------------------------------------ */

export interface VaultGraph {
  entities(): Promise<MemoryGraphNode[]>;
  relationships(): Promise<MemoryGraphEdge[]>;
  query(pattern: string): Promise<MemoryGraphNode[]>;
}

function createGraph(vaultPath: string): VaultGraph {
  return {
    async entities(): Promise<MemoryGraphNode[]> {
      const graph: MemoryGraphIndex | null = await loadMemoryGraphIndex(vaultPath);
      return (graph as any)?.nodes ?? [];
    },

    async relationships(): Promise<MemoryGraphEdge[]> {
      const graph: MemoryGraphIndex | null = await loadMemoryGraphIndex(vaultPath);
      return (graph as any)?.edges ?? [];
    },

    async query(pattern: string): Promise<MemoryGraphNode[]> {
      const graph: MemoryGraphIndex | null = await loadMemoryGraphIndex(vaultPath);
      if (!graph) return [];
      const re = new RegExp(pattern, 'i');
      const nodes: MemoryGraphNode[] = (graph as any).nodes ?? [];
      return nodes.filter((n: MemoryGraphNode) => re.test(n.id) || re.test((n as any).label ?? ''));
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Preferences sub-object                                             */
/* ------------------------------------------------------------------ */

export interface VaultPreferences {
  get(): Promise<ExtractedPreference[]>;
  extract(text: string): ExtractedPreference[];
}

function createPreferences(core: ClawVault): VaultPreferences {
  return {
    async get(): Promise<ExtractedPreference[]> {
      const results = await core.find('preferences', { limit: 100 });
      const allPrefs: ExtractedPreference[] = [];
      for (const r of results) {
        allPrefs.push(...extractPreferences((r as any).content ?? ''));
      }
      return allPrefs;
    },

    extract(text: string): ExtractedPreference[] {
      return extractPreferences(text);
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Vault class                                                        */
/* ------------------------------------------------------------------ */

export class Vault {
  private core: ClawVault;
  private vaultPath: string;

  public readonly graph: VaultGraph;
  public readonly preferences: VaultPreferences;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.core = new ClawVault(vaultPath);
    this.graph = createGraph(vaultPath);
    this.preferences = createPreferences(this.core);
  }

  /** BM25 + vector search over vault documents. */
  async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
    await this.core.load();
    return this.core.find(query, opts);
  }

  /** Store an observation into the vault. */
  async observe(content: string, opts?: { category?: string; tags?: string[]; title?: string }): Promise<Document> {
    await this.core.load();
    return this.core.store({
      category: opts?.category ?? 'observations',
      title: opts?.title ?? `observation-${Date.now()}`,
      content,
    });
  }

  /** Build a context bundle for LLM consumption. */
  async context(opts?: Partial<ContextOptions>): Promise<ContextResult> {
    return buildContext(this.vaultPath, opts as ContextOptions);
  }

  /** Create a vault checkpoint (snapshot). */
  async checkpoint(): Promise<string> {
    throw new Error('@clawvault/sdk: checkpoint() not yet implemented');
  }

  /** Restore the vault to a previous checkpoint. */
  async restore(id: string): Promise<void> {
    throw new Error('@clawvault/sdk: restore() not yet implemented');
  }
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Create a Vault SDK instance pointing at the given path.
 */
export function createVault(vaultPath: string): Vault {
  return new Vault(vaultPath);
}
