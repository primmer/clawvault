/**
 * ClawVault Plugin v2 — Type definitions
 */

// ─── Template & Schema Types ────────────────────────────────────────────────

export interface FieldDef {
  type: 'string' | 'number' | 'boolean' | 'datetime' | 'date';
  required?: boolean;
  default?: string | number | boolean;
  enum?: string[];
  description?: string;
}

export interface TemplateSchema {
  primitive: string;
  description?: string;
  fields: Record<string, FieldDef>;
  bodyTemplate?: string;
  keywords?: string[];
}

export interface TemplateRegistry {
  schemas: Map<string, TemplateSchema>;
  keywordIndex: Map<string, string[]>;
  initialized: boolean;
}

export interface ClassificationResult {
  primitiveType: string;
  confidence: number;
  matchedKeywords: string[];
}

export interface FrontmatterOptions {
  title?: string;
  extraFields?: Record<string, unknown>;
  source?: string;
  sessionId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Observation Types ──────────────────────────────────────────────────────

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

export interface ObservationPattern {
  pattern: RegExp;
  weight: number;
}

// ─── Vault File Types ───────────────────────────────────────────────────────

export interface VaultFile {
  path: string;
  relativePath: string;
  primitiveType: string;
  frontmatter: Record<string, unknown>;
  content: string;
  modifiedAt: Date;
  createdAt: Date;
}

export interface WriteResult {
  success: boolean;
  path: string;
  primitiveType: string;
  errors: string[];
  created: boolean;
  updated: boolean;
}

export interface WriteOptions {
  primitiveType?: string;
  title?: string;
  content?: string;
  extraFields?: Record<string, unknown>;
  source?: string;
  sessionId?: string;
  directory?: string;
  filename?: string;
  overwrite?: boolean;
}

export interface LedgerEntry {
  timestamp: Date;
  category?: string;
  actor?: string;
  content: string;
  primitiveType?: string;
  tags?: string[];
}

export interface BatchWriteOptions {
  source?: string;
  sessionId?: string;
  actor?: string;
  writeLedger?: boolean;
  writeFiles?: boolean;
}

export interface BatchWriteResult {
  total: number;
  successful: number;
  failed: number;
  results: WriteResult[];
}

// ─── Context / Injection Types ──────────────────────────────────────────────

export interface ScanOptions {
  maxAge?: number;
  limit?: number;
  primitiveTypes?: string[];
}

export interface SessionRecapResult {
  xml: string;
  fileCount: number;
  primitiveGroups: Record<string, number>;
  timeRange: { oldest: Date; newest: Date } | null;
}

export interface PreferenceContextResult {
  xml: string;
  preferenceCount: number;
  categories: string[];
}

// ─── Search / Retrieval Types ───────────────────────────────────────────────

export interface QmdResult {
  file?: string;
  title?: string;
  snippet?: string;
  score?: number;
}

export interface ScoredResult extends QmdResult {
  /** Fused score after all scoring stages */
  fusedScore: number;
  /** Original BM25 rank (if applicable) */
  bm25Rank?: number;
  /** Semantic similarity score */
  semanticScore?: number;
  /** Reranker score (if available) */
  rerankScore?: number;
  /** Recency boost applied */
  recencyBoost?: number;
  /** Time decay factor applied */
  timeDecay?: number;
  /** Length normalization factor */
  lengthNorm?: number;
  /** Memory scope */
  scope?: MemoryScope;
}

// ─── Scope Types ────────────────────────────────────────────────────────────

export type MemoryScope = 'global' | `agent:${string}` | `project:${string}` | `user:${string}`;

export function parseScope(scope: string): MemoryScope {
  if (scope === 'global') return 'global';
  if (scope.startsWith('agent:') || scope.startsWith('project:') || scope.startsWith('user:')) {
    return scope as MemoryScope;
  }
  return 'global';
}

export function matchesScope(itemScope: MemoryScope, filterScope: MemoryScope): boolean {
  if (filterScope === 'global') return true;
  return itemScope === filterScope;
}

// ─── Retrieval Config Types ─────────────────────────────────────────────────

export interface RetrievalConfig {
  /** BM25 weight in RRF fusion (default: 0.5) */
  bm25Weight: number;
  /** Semantic weight in RRF fusion (default: 0.5) */
  semanticWeight: number;
  /** RRF k parameter (default: 60) */
  rrfK: number;
  /** Max results to return (default: 10) */
  topK: number;
  /** Minimum score threshold (default: 0.01) */
  minScore: number;

  /** Recency boost half-life in days (default: 14, 0 = disabled) */
  recencyHalfLifeDays: number;
  /** Recency boost weight (default: 0.10) */
  recencyWeight: number;

  /** Time decay half-life in days (default: 60, 0 = disabled) */
  decayHalfLifeDays: number;

  /** Length normalization anchor in chars (default: 500, 0 = disabled) */
  lengthNormAnchor: number;

  /** MMR lambda for diversity (default: 0.7, 1.0 = no diversity) */
  mmrLambda: number;

  /** Reranker provider (default: none) */
  rerankProvider?: 'jina' | 'voyage' | 'siliconflow' | 'pinecone';
  /** Reranker API key */
  rerankApiKey?: string;
  /** Reranker model name */
  rerankModel?: string;
  /** Reranker endpoint URL */
  rerankEndpoint?: string;
  /** Reranker weight vs fused score (default: 0.6) */
  rerankWeight: number;
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  bm25Weight: 0.5,
  semanticWeight: 0.5,
  rrfK: 60,
  topK: 10,
  minScore: 0.01,
  recencyHalfLifeDays: 14,
  recencyWeight: 0.10,
  decayHalfLifeDays: 60,
  lengthNormAnchor: 500,
  mmrLambda: 0.7,
  rerankWeight: 0.6,
};

// ─── Plugin Config ──────────────────────────────────────────────────────────

export interface PluginConfig {
  vaultPath?: string;
  agentVaults?: Record<string, string>;
  collection?: string;
  autoRecall?: boolean;
  autoCapture?: boolean;
  recallLimit?: number;
  templatesDir?: string;
  autoCheckpoint?: boolean;
  contextProfile?: 'default' | 'planning' | 'incident' | 'handoff' | 'auto';
  maxContextResults?: number;
  observeOnHeartbeat?: boolean;
  weeklyReflection?: boolean;
  /** Retrieval pipeline config */
  retrieval?: Partial<RetrievalConfig>;
  /** Noise filter config */
  noise?: {
    enabled?: boolean;
    minLength?: number;
    maxLength?: number;
  };
  /** Adaptive retrieval config */
  adaptive?: {
    enabled?: boolean;
    skipPatterns?: string[];
  };
  /** Default memory scope */
  defaultScope?: MemoryScope;
}

// ─── OpenClaw Plugin API Types ──────────────────────────────────────────────

export interface PluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute(id: string, params: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface ServiceDefinition {
  id: string;
  start: () => void;
  stop: () => void;
}

export interface CommandDefinition {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: (ctx: { args?: string }) => { text: string };
}

export type EventHandler = (event: Record<string, unknown>) => Promise<unknown>;

export interface PluginApi {
  pluginConfig: PluginConfig;
  logger: PluginLogger;
  registerTool(tool: ToolDefinition): void;
  registerService(service: ServiceDefinition): void;
  registerCommand(command: CommandDefinition): void;
  registerCli(fn: (ctx: { program: unknown }) => void, opts?: { commands: string[] }): void;
  on(event: string, handler: EventHandler, opts?: { priority?: number }): void;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  kind: string;
  register(api: PluginApi): void;
}
