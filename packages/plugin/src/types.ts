/**
 * Core types for ClawVault OpenClaw plugin
 */

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string | Date;
}

export interface SearchResult {
  id: string;
  title: string;
  content: string;
  snippet: string;
  score: number;
  category?: string;
  path?: string;
  modifiedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit?: number;
  category?: string;
  dateRange?: {
    start?: Date;
    end?: Date;
  };
  threshold?: number;
  queryType?: QueryType;
}

export type QueryType = 
  | 'factual'      // Looking for specific facts
  | 'preference'   // User preferences/likes/dislikes
  | 'temporal'     // Time-based queries
  | 'semantic'     // General semantic search
  | 'auto';        // Auto-detect

export interface Preference {
  category: string;
  item: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  source?: string;
  extractedAt: Date;
}

export interface DateIndex {
  date: string;
  documents: string[];
  events: Array<{
    title: string;
    documentId: string;
    type?: string;
  }>;
}

export interface IngestResult {
  documentsCreated: number;
  preferencesExtracted: number;
  datesIndexed: number;
  sessionId: string;
}

export interface VaultStatus {
  initialized: boolean;
  documentCount: number;
  categories: Record<string, number>;
  lastActivity?: Date;
  preferencesCount: number;
  datesIndexedCount: number;
}

export interface PluginConfig {
  vaultPath?: string;
  observer?: {
    enabled?: boolean;
    tokenThreshold?: number;
    model?: string;
  };
  search?: {
    defaultLimit?: number;
    bm25PrefilterK?: number;
    exhaustiveThreshold?: number;
  };
}

export interface OpenClawApi {
  config?: unknown;
  logger?: Logger;
  registerTool?: (name: string, schema: ToolSchema, handler: ToolHandler) => void;
  registerService?: (service: Service) => void;
  registerCommand?: (command: SlashCommand) => void;
  registerHook?: (hookName: string, handler: HookHandler) => void;
  getPluginConfig?: (pluginId: string) => PluginConfig | undefined;
}

export interface Logger {
  debug?: (payload: unknown, message?: string) => void;
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
  error?: (payload: unknown, message?: string) => void;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

export interface Service {
  id: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface SlashCommand {
  name: string;
  description?: string;
  handler: (input: { args?: string; context?: unknown }) => Promise<{ content: string }>;
}

export type HookHandler = (event: HookEvent) => Promise<void> | void;

export interface HookEvent {
  type: string;
  sessionId?: string;
  messages?: Message[];
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}
