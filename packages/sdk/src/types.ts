/**
 * ClawVault SDK Types
 */

/** Search strategy for vault queries */
export type SearchStrategy = 'bm25' | 'semantic' | 'hybrid';

/** A single search result from the vault */
export interface SearchResult {
  /** Document ID (qmd internal) */
  docId: string;
  /** Relevance score (0-1) */
  score: number;
  /** File path relative to vault root */
  file: string;
  /** Document title (from frontmatter or first heading) */
  title: string;
  /** Content snippet with match context */
  snippet: string;
  /** Full document content (only if requested) */
  content?: string;
}

/** Options for search operations */
export interface SearchOptions {
  /** Search strategy (default: 'hybrid') */
  strategy?: SearchStrategy;
  /** Max results to return (default: 10) */
  limit?: number;
  /** Filter to specific collection */
  collection?: string;
  /** Time range filter (e.g., 'last 7 days', 'last month') */
  timeRange?: string;
  /** Return full document content */
  includeContent?: boolean;
}

/** Options for observe operations */
export interface ObserveOptions {
  /** Who is writing this observation */
  actor?: string;
  /** Session identifier */
  session?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Skip LLM compression */
  raw?: boolean;
}

/** Observation result */
export interface ObserveResult {
  /** Whether the observation was written successfully */
  ok: boolean;
  /** Path to the written observation file */
  path?: string;
  /** Error message if failed */
  error?: string;
}

/** Context retrieval options */
export interface ContextOptions {
  /** Session to retrieve context for */
  session?: string;
  /** How deep to recurse into related documents */
  depth?: number;
  /** Include user preferences in context */
  includePrefs?: boolean;
  /** Max characters to return */
  maxChars?: number;
}

/** Context result */
export interface ContextResult {
  /** The context text */
  text: string;
  /** Sources that contributed to the context */
  sources: string[];
  /** Character count */
  charCount: number;
}

/** Vault status information */
export interface VaultStatus {
  /** Path to the vault directory */
  path: string;
  /** Vault name from config */
  name: string;
  /** qmd collection name */
  collection: string;
  /** Number of indexed documents */
  documentCount: number;
  /** Number of vector embeddings */
  vectorCount: number;
  /** Categories defined in vault config */
  categories: string[];
  /** Last index update time */
  lastUpdated: string;
}

/** Checkpoint metadata */
export interface Checkpoint {
  /** Checkpoint ID */
  id: string;
  /** When the checkpoint was created */
  createdAt: string;
  /** Description of vault state at checkpoint */
  description?: string;
}

/** Configuration for the ClawVault SDK */
export interface ClawVaultConfig {
  /** Path to the vault directory */
  path: string;
  /** qmd collection name (auto-detected if omitted) */
  collection?: string;
  /** Default search strategy */
  defaultStrategy?: SearchStrategy;
  /** Default search limit */
  defaultLimit?: number;
  /** Path to qmd binary (default: 'qmd' from PATH) */
  qmdBin?: string;
  /** Path to clawvault binary (default: 'clawvault' from PATH) */
  clawvaultBin?: string;
  /** Timeout for CLI operations in ms (default: 30000) */
  timeout?: number;
}
