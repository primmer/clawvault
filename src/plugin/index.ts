/**
 * ClawVault OpenClaw Plugin
 *
 * Memory slot provider — replaces memory-core with ClawVault's
 * BM25+semantic search, preference extraction, and smart query routing.
 *
 * Follows OpenClaw plugin SDK patterns (memory-core, memory-lancedb).
 */

import { Type } from '@sinclair/typebox';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// OpenClaw plugin API type — we use `any` to avoid depending on openclaw package
// The actual API shape matches OpenClawPluginApi from openclaw/plugin-sdk
type OpenClawPluginApi = any;

// ClawVault imports — now direct imports from sibling modules
import { ClawVaultMemoryProvider } from './provider/index.js';
import type { SearchOptions } from './types.js';

let provider: ClawVaultMemoryProvider | null = null;

export function getProvider(): ClawVaultMemoryProvider | null {
  return provider;
}

const configSchema = Type.Object({
  vaultPath: Type.Optional(Type.String({ description: 'Path to ClawVault vault directory. Defaults to $CLAWVAULT_PATH or ~/clawvault' })),
  bm25PrefilterK: Type.Optional(Type.Number({ default: 50, description: 'BM25 pre-filter candidates' })),
  exhaustiveThreshold: Type.Optional(Type.Number({ default: 0.3, description: 'Score threshold for exhaustive retrieval' })),
  defaultLimit: Type.Optional(Type.Number({ default: 10, description: 'Default search result limit' })),
  autoCapture: Type.Optional(Type.Object({
    enabled: Type.Optional(Type.Boolean({ default: false, description: 'Auto-capture messages as observations' })),
    tokenThreshold: Type.Optional(Type.Number({ default: 2000, description: 'Token threshold before compression' })),
  })),
});

function resolveVaultPath(cfg: any, api: any): string {
  if (cfg?.vaultPath) return cfg.vaultPath;
  if (process.env.CLAWVAULT_PATH) return process.env.CLAWVAULT_PATH;
  // Try common locations
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  for (const candidate of [`${home}/clawvault`, `${home}/.clawvault`]) {
    if (existsSync(join(candidate, '.clawvault.json'))) return candidate;
  }
  return api?.resolvePath?.('clawvault') ?? `${home}/.clawvault`;
}

const clawvaultPlugin = {
  id: 'clawvault',
  name: 'ClawVault Memory Provider',
  description: 'Structured agent memory with BM25 search, preference extraction, temporal indexing, and smart query routing',
  kind: 'memory' as const,
  configSchema,

  register(api: OpenClawPluginApi) {
    const cfg = api.pluginConfig ?? {};
    const vaultPath = resolveVaultPath(cfg, api);

    provider = new ClawVaultMemoryProvider({
      vaultPath,
      bm25PrefilterK: cfg.bm25PrefilterK ?? 50,
      exhaustiveThreshold: cfg.exhaustiveThreshold ?? 0.3,
      defaultLimit: cfg.defaultLimit ?? 10,
    });

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool({
      name: 'memory_search',
      label: 'Memory Search',
      description: 'Search through long-term memories using ClawVault. Supports preferences, temporal queries, and multi-session knowledge retrieval.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query — natural language question or keyword search' }),
        limit: Type.Optional(Type.Number({ description: 'Max results (default: 10)' })),
        queryType: Type.Optional(Type.Union([
          Type.Literal('preference'),
          Type.Literal('temporal'),
          Type.Literal('knowledge'),
          Type.Literal('general'),
        ], { description: 'Force query type (auto-detected if omitted)' })),
      }),
      async execute(_toolCallId: string, params: { query: string; limit?: number; queryType?: string }) {
        try {
          const results = await provider!.search(params.query, {
            limit: params.limit,
            queryType: params.queryType as SearchOptions['queryType'],
          });

          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: 'No relevant memories found.' }],
              details: { count: 0, provider: 'clawvault' },
            };
          }

          const text = results
            .map((r, i) => {
              const body = r.content || r.snippet || r.title || '(no content)';
              const source = r.path || r.id || r.category || 'memory';
              return `${i + 1}. [${source}] ${body} (score: ${(r.score * 100).toFixed(0)}%)`;
            })
            .join('\n');

          return {
            content: [{ type: 'text', text }],
            details: { count: results.length, provider: 'clawvault' },
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Memory search error: ${String(err)}` }],
            isError: true,
          };
        }
      },
    });

    api.registerTool({
      name: 'memory_get',
      label: 'Memory Get',
      description: 'Get a specific memory or vault status.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('status'),
          Type.Literal('preferences'),
        ], { description: 'What to retrieve' }),
      }),
      async execute(_toolCallId: string, params: { action: string }) {
        try {
          if (params.action === 'preferences') {
            const prefs = await provider!.getPreferences();
            if (prefs.length === 0) {
              return { content: [{ type: 'text', text: 'No preferences stored.' }] };
            }
            const text = prefs
              .map((p, i) => `${i + 1}. ${p.category}/${p.item}: ${p.sentiment} (confidence: ${p.confidence})`)
              .join('\n');
            return { content: [{ type: 'text', text }] };
          }

          const status = await provider!.getStatus();
          return {
            content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Memory get error: ${String(err)}` }],
            isError: true,
          };
        }
      },
    });

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: 'clawvault',
      start: () => {
        api.logger.info(`clawvault: initialized (vault: ${vaultPath})`);
      },
      stop: () => {
        api.logger.info('clawvault: stopped');
      },
    });

    // ========================================================================
    // CLI
    // ========================================================================

    api.registerCli(
      ({ program }: any) => {
        const cmd = program.command('vault').description('ClawVault memory commands');
        cmd.command('status').description('Show vault status').action(async () => {
          const status = await provider!.getStatus();
          console.log(JSON.stringify(status, null, 2));
        });
        cmd.command('search <query>').description('Search vault').action(async (query: string) => {
          const results = await provider!.search(query);
          results.forEach((r, i) => {
            console.log(`${i + 1}. [${r.id}] ${r.snippet || r.title} (${(r.score * 100).toFixed(0)}%)`);
          });
        });
      },
      { commands: ['vault'] },
    );

    api.logger.info('[clawvault] Memory plugin registered', { vaultPath });
  },
};

export default clawvaultPlugin;

// Re-export types and utilities for consumers
export type {
  Message,
  SearchResult,
  SearchOptions,
  Preference,
  DateIndex,
  IngestResult,
  VaultStatus,
  QueryType,
  PluginConfig,
} from './types.js';

export { ClawVaultMemoryProvider, createMemoryProvider } from './provider/index.js';
export type { MemoryProvider, MemoryProviderOptions } from './provider/index.js';

export { ObserverService, createObserverService } from './services/observer.js';
export type { ObserverServiceOptions } from './services/observer.js';

export { memorySearchSchema, createMemorySearchHandler } from './tools/memory-search.js';
export type { MemorySearchInput, MemorySearchOutput } from './tools/memory-search.js';

export { vaultStatusSchema, createVaultStatusHandler } from './tools/vault-status.js';
export type { VaultStatusInput, VaultStatusOutput } from './tools/vault-status.js';

export { vaultPreferencesSchema, createVaultPreferencesHandler } from './tools/vault-preferences.js';
export type { VaultPreferencesInput, VaultPreferencesOutput } from './tools/vault-preferences.js';
