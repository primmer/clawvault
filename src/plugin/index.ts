/**
 * ClawVault Plugin v2 — Main Entry Point
 *
 * OpenClaw memory plugin with:
 * - Template-driven typed primitives
 * - In-process hybrid retrieval (BM25 + Semantic + RRF)
 * - Cross-encoder rerank (optional, API-based)
 * - Recency boost + time decay
 * - Length normalization + MMR diversity
 * - Noise filtering + adaptive retrieval
 * - Multi-scope support (global, agent, project, user)
 * - Management CLI (stats, export, import, reembed)
 */

import { execFileSync, execFile } from 'child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, renameSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import { Type } from '@sinclair/typebox';

import {
  initializeTemplateRegistry, getTemplateRegistry,
  classifyText, getSchema, getAllSchemas, getSchemaNames,
  parseYamlFrontmatter,
} from './templates.js';
import {
  isObservable, extractObservations, processMessageForObservations,
  detectCategory, extractSearchTerms,
} from './observe.js';
import {
  buildSessionRecap, buildPreferenceContext, buildFullContext,
  formatMemoriesForContext, formatSearchResults,
  scanVaultFiles,
} from './inject.js';
import {
  writeVaultFile, writeObservation, appendToLedger,
  appendObservationToLedger, batchWriteObservations,
  ensureVaultStructure, setAutoEmbedFn,
} from './vault.js';
import { retrieve, qmdHybridSearch } from './retrieval.js';
import { isNoise, type NoiseFilterConfig, DEFAULT_NOISE_CONFIG } from './noise-filter.js';
import { shouldRetrieve, type AdaptiveConfig, DEFAULT_ADAPTIVE_CONFIG } from './adaptive-retrieval.js';
import type {
  Plugin, PluginApi, PluginConfig, TemplateRegistry,
  RetrievalConfig, MemoryScope, QmdResult,
} from './types.js';
import { DEFAULT_RETRIEVAL_CONFIG, parseScope } from './types.js';

// ─── Plugin Version ─────────────────────────────────────────────────────────

const PLUGIN_VERSION = '4.0.0';

// ─── Vault Path Resolution ─────────────────────────────────────────────────

function resolveVaultPath(cfg: PluginConfig | undefined): string {
  if (cfg?.vaultPath) return cfg.vaultPath;
  if (process.env.CLAWVAULT_PATH) return process.env.CLAWVAULT_PATH;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  for (const candidate of [`${home}/clawvault`, `${home}/.clawvault`]) {
    if (existsSync(join(candidate, '.clawvault.json'))) return candidate;
  }
  return `${home}/.clawvault`;
}

function getVaultConfig(vaultPath: string): Record<string, unknown> | null {
  const configPath = join(vaultPath, '.clawvault.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Auto-Embed via Ollama ──────────────────────────────────────────────────

async function autoEmbedViaOllama(filePath: string, content: string): Promise<void> {
  try {
    const { dirname, join: pathJoin, relative: pathRelative } = await import('path');
    const { existsSync: fsExists, readFileSync: fsRead, writeFileSync: fsWrite, mkdirSync: fsMkdir } = await import('fs');

    let vaultPath = dirname(filePath);
    for (let i = 0; i < 10; i++) {
      if (fsExists(pathJoin(vaultPath, '.clawvault.json'))) break;
      const parent = dirname(vaultPath);
      if (parent === vaultPath) return;
      vaultPath = parent;
    }

    const cachePath = pathJoin(vaultPath, '.clawvault', 'embeddings.bin.json');
    const docId = pathRelative(vaultPath, filePath).replace(/\.md$/, '');

    const resp = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: content.slice(0, 2000) }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) return;
    const data = await resp.json() as { embedding: number[] };

    let cache: Record<string, number[]> = {};
    try { cache = JSON.parse(fsRead(cachePath, 'utf-8')) as Record<string, number[]>; } catch { /* fresh */ }

    cache[docId] = data.embedding;

    const dir = dirname(cachePath);
    if (!fsExists(dir)) fsMkdir(dir, { recursive: true });
    fsWrite(cachePath, JSON.stringify(cache));
  } catch {
    // Best-effort embedding
  }
}

// ─── Async qmd update ──────────────────────────────────────────────────────

function qmdUpdateAsync(collection: string): void {
  try {
    execFile('qmd', ['update', '-c', collection], { timeout: 30000 }, () => { /* fire and forget */ });
    execFile('qmd', ['embed', '-c', collection], { timeout: 60000 }, () => { /* fire and forget */ });
  } catch {
    // qmd not available
  }
}

// ─── observe via CLI ────────────────────────────────────────────────────────

function observeViaCli(vaultPath: string, content: string, meta: { tags?: string[] } = {}): void {
  try {
    const args = ['observe', '--content', content];
    if (meta.tags?.length) args.push('--tags', meta.tags.join(','));
    execFile('clawvault', args, { cwd: vaultPath, timeout: 15000 }, () => { /* fire and forget */ });
  } catch {
    // clawvault CLI not available
  }
}

// ─── Management CLI ─────────────────────────────────────────────────────────

interface MemoryStats {
  vault: string;
  version: string;
  documents: number;
  vectors: number;
  categories: Record<string, number>;
  oldestDoc: string | null;
  newestDoc: string | null;
  totalSizeKb: number;
}

function computeMemoryStats(vaultPath: string, collection: string): MemoryStats {
  const stats: MemoryStats = {
    vault: vaultPath,
    version: PLUGIN_VERSION,
    documents: 0,
    vectors: 0,
    categories: {},
    oldestDoc: null,
    newestDoc: null,
    totalSizeKb: 0,
  };

  // Count documents by scanning vault
  const files = scanVaultFiles(vaultPath, { maxAge: Infinity, limit: 10000 });
  stats.documents = files.length;

  for (const file of files) {
    const cat = file.primitiveType;
    stats.categories[cat] = (stats.categories[cat] || 0) + 1;
  }

  if (files.length > 0) {
    const sorted = [...files].sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime());
    stats.oldestDoc = sorted[0].modifiedAt.toISOString();
    stats.newestDoc = sorted[sorted.length - 1].modifiedAt.toISOString();
  }

  // Check embedding cache
  const cachePath = join(vaultPath, '.clawvault', 'embeddings.bin.json');
  if (existsSync(cachePath)) {
    try {
      const cacheData = JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<string, unknown>;
      stats.vectors = Object.keys(cacheData).length;
      const cacheStats = statSync(cachePath);
      stats.totalSizeKb = Math.round(cacheStats.size / 1024);
    } catch { /* ignore */ }
  }

  // Try qmd status
  try {
    const qmdStats = execFileSync('qmd', ['status', '--json', '-c', collection], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(qmdStats) as Record<string, unknown>;
    if (typeof parsed.documents === 'number') stats.documents = Math.max(stats.documents, parsed.documents);
    if (typeof parsed.vectors === 'number') stats.vectors = Math.max(stats.vectors, parsed.vectors);
  } catch { /* qmd not available */ }

  return stats;
}

function exportMemories(vaultPath: string, outputPath: string): { count: number; path: string } {
  const files = scanVaultFiles(vaultPath, { maxAge: Infinity, limit: 100000 });
  const memories = files.map(f => ({
    path: f.relativePath,
    primitiveType: f.primitiveType,
    frontmatter: f.frontmatter,
    content: f.content,
    modifiedAt: f.modifiedAt.toISOString(),
    createdAt: f.createdAt.toISOString(),
  }));

  writeFileSync(outputPath, JSON.stringify(memories, null, 2), 'utf-8');
  return { count: memories.length, path: outputPath };
}

function importMemories(
  vaultPath: string,
  inputPath: string,
): { imported: number; skipped: number; errors: string[] } {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  try {
    const data = JSON.parse(readFileSync(inputPath, 'utf-8')) as Array<{
      primitiveType: string;
      frontmatter: Record<string, unknown>;
      content: string;
      path?: string;
    }>;

    for (const entry of data) {
      const title = String(entry.frontmatter?.title || entry.frontmatter?.summary || '');
      const result = writeVaultFile(vaultPath, {
        primitiveType: entry.primitiveType || 'memory_event',
        title: title.slice(0, 80) || undefined,
        content: entry.content,
        extraFields: entry.frontmatter,
      });
      if (result.success) imported++;
      else {
        skipped++;
        if (result.errors.length > 0) errors.push(...result.errors);
      }
    }
  } catch (err) {
    errors.push(`Import failed: ${String(err)}`);
  }

  return { imported, skipped, errors };
}

// ─── Plugin Definition ──────────────────────────────────────────────────────

let templateRegistry: TemplateRegistry | null = null;

const clawvaultPlugin: Plugin = {
  id: 'clawvault',
  name: 'ClawVault Memory',
  description: 'Template-driven observational memory with hybrid search, cross-encoder reranking, and adaptive retrieval. Memories are captured automatically from conversations and classified against template schemas.',
  version: PLUGIN_VERSION,
  kind: 'memory',

  register(api: PluginApi): void {
    const cfg = api.pluginConfig || {};
    const vaultPath = resolveVaultPath(cfg);
    const collection = cfg.collection || 'clawvault';
    const autoRecall = cfg.autoRecall !== false;
    const autoCapture = cfg.autoCapture !== false;
    const recallLimit = cfg.recallLimit || 5;
    const templatesDir = cfg.templatesDir ?? join(vaultPath, '..', '..', 'templates');
    const defaultScope = parseScope(cfg.defaultScope || 'global');

    // Merge retrieval config
    const retrievalConfig: RetrievalConfig = {
      ...DEFAULT_RETRIEVAL_CONFIG,
      ...cfg.retrieval,
    };

    // Noise filter config
    const noiseConfig: NoiseFilterConfig = {
      ...DEFAULT_NOISE_CONFIG,
      ...cfg.noise,
    };

    // Adaptive config
    const adaptiveConfig: AdaptiveConfig = {
      ...DEFAULT_ADAPTIVE_CONFIG,
      ...cfg.adaptive,
    };

    // Initialize templates
    templateRegistry = initializeTemplateRegistry(templatesDir);
    api.logger.info(`[clawvault] Template registry initialized with ${templateRegistry.schemas.size} schemas`);

    // Set up auto-embed hook
    setAutoEmbedFn(autoEmbedViaOllama);

    // Validate vault
    if (!existsSync(join(vaultPath, '.clawvault.json'))) {
      api.logger.warn(`[clawvault] Vault not found at ${vaultPath}`);
      return;
    }

    ensureVaultStructure(vaultPath);
    api.logger.info(
      `[clawvault] v${PLUGIN_VERSION} vault=${vaultPath} collection=${collection} ` +
      `recall=${autoRecall} capture=${autoCapture} scope=${defaultScope}`,
    );

    // ── Tool: memory_search ─────────────────────────────────────────────

    api.registerTool({
      name: 'memory_search',
      label: 'Memory Search',
      description: 'Search through long-term memories using ClawVault. Uses in-process hybrid retrieval with BM25 + semantic search, RRF fusion, optional reranking, and MMR diversity.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query — natural language question or keyword search' }),
        limit: Type.Optional(Type.Number({ description: 'Max results (default: 10)' })),
        queryType: Type.Optional(Type.Union([
          Type.Literal('preference'),
          Type.Literal('temporal'),
          Type.Literal('knowledge'),
          Type.Literal('general'),
        ], { description: 'Force query type (auto-detected if omitted)' })),
        scope: Type.Optional(Type.String({ description: 'Memory scope filter (global, agent:<id>, project:<name>, user:<id>)' })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          let searchQuery = params.query as string;
          if (params.queryType === 'preference') searchQuery = `preference: ${searchQuery}`;
          else if (params.queryType === 'temporal') searchQuery = `when: ${searchQuery}`;

          const limit = (params.limit as number) || 10;
          const scope = parseScope((params.scope as string) || defaultScope);

          const results = await retrieve(searchQuery, {
            vaultPath,
            collection,
            config: { ...retrievalConfig, topK: limit },
            scope,
          });

          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: 'No relevant memories found.' }],
              details: { count: 0, provider: 'clawvault' },
            };
          }

          const formatted = results.map((r, i) => {
            const file = (r.file || '').replace(`qmd://${collection}/`, '');
            const snippet = (r.snippet || '').replace(/@@ .+? @@\s*\(.+?\)\n?/g, '').trim() || r.title || '(no content)';
            const score = (r.fusedScore * 100).toFixed(0);
            return `${i + 1}. [${file}] ${snippet} (${score}%)`;
          }).join('\n');

          return {
            content: [{ type: 'text', text: formatted }],
            details: { count: results.length, provider: 'clawvault', pipeline: 'hybrid-v2' },
          };
        } catch (err) {
          // Fallback to qmd
          try {
            const results = qmdHybridSearch(params.query as string, collection, (params.limit as number) || 10);
            return {
              content: [{ type: 'text', text: formatSearchResults(results, collection) }],
              details: { count: results.length, provider: 'clawvault', pipeline: 'qmd-fallback' },
            };
          } catch {
            return {
              content: [{ type: 'text', text: `Memory search error: ${String(err)}` }],
              isError: true,
            };
          }
        }
      },
    });

    // ── Tool: memory_get ────────────────────────────────────────────────

    api.registerTool({
      name: 'memory_get',
      label: 'Memory Get',
      description: 'Get vault status, stored preferences, or memory stats.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('status'),
          Type.Literal('preferences'),
          Type.Literal('stats'),
        ], { description: 'What to retrieve' }),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          if (params.action === 'status' || params.action === 'stats') {
            const stats = computeMemoryStats(vaultPath, collection);
            return {
              content: [{ type: 'text', text: JSON.stringify({
                ...stats,
                autoRecall,
                autoCapture,
                templateSchemas: templateRegistry?.schemas.size ?? 0,
                scope: defaultScope,
                retrieval: {
                  rerankProvider: retrievalConfig.rerankProvider || 'none',
                  mmrLambda: retrievalConfig.mmrLambda,
                  recencyHalfLife: retrievalConfig.recencyHalfLifeDays,
                  decayHalfLife: retrievalConfig.decayHalfLifeDays,
                },
              }, null, 2) }],
            };
          }

          // preferences
          const prefContext = buildPreferenceContext(vaultPath, { limit: 20 });
          if (prefContext.preferenceCount === 0) {
            const results = qmdHybridSearch('user preference likes dislikes prefers wants', collection, 20);
            const prefResults = results.filter(
              (r: QmdResult) => r.file?.includes('preference') ||
                r.snippet?.toLowerCase().match(/prefer|like|want|hate|love|always|never/),
            );
            if (prefResults.length === 0) {
              return { content: [{ type: 'text', text: 'No preferences found in vault.' }] };
            }
            const text = prefResults.map((r: QmdResult, i: number) => {
              const file = (r.file || '').replace(`qmd://${collection}/`, '');
              const snippet = (r.snippet || '').replace(/@@ .+? @@\s*\(.+?\)\n?/g, '').trim() || r.title;
              return `${i + 1}. [${file}] ${snippet}`;
            }).join('\n');
            return { content: [{ type: 'text', text }] };
          }
          return { content: [{ type: 'text', text: prefContext.xml }] };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Memory get error: ${String(err)}` }],
            isError: true,
          };
        }
      },
    });

    // ── Tool: memory_store ──────────────────────────────────────────────

    api.registerTool({
      name: 'memory_store',
      label: 'Memory Store',
      description: 'Save important information in long-term memory. Use for preferences, facts, decisions, or anything worth remembering.',
      parameters: Type.Object({
        text: Type.String({ description: 'Information to remember' }),
        category: Type.Optional(Type.Union([
          Type.Literal('preference'),
          Type.Literal('fact'),
          Type.Literal('decision'),
          Type.Literal('entity'),
          Type.Literal('event'),
          Type.Literal('other'),
        ], { description: 'Memory category (auto-detected if omitted)' })),
        tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for organization' })),
        scope: Type.Optional(Type.String({ description: 'Memory scope (global, agent:<id>, project:<name>, user:<id>)' })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          const text = params.text as string;

          // Noise filter on write
          if (noiseConfig.enabled) {
            const check = isNoise(text, noiseConfig);
            if (check.isNoise) {
              return {
                content: [{ type: 'text', text: `Skipped: content filtered (${check.reason})` }],
                details: { action: 'filtered', reason: check.reason },
              };
            }
          }

          const classification = classifyText(text);
          const category = (params.category as string) || detectCategory(text);
          const tags = (params.tags as string[]) || [category, ...classification.matchedKeywords.slice(0, 3)];
          const scope = parseScope((params.scope as string) || defaultScope);

          const CATEGORY_TO_PRIMITIVE: Record<string, string> = {
            preference: 'memory_event',
            fact: 'memory_event',
            decision: 'decision',
            entity: 'person',
            event: 'memory_event',
            other: 'memory_event',
          };

          const effectivePrimitive = params.category
            ? CATEGORY_TO_PRIMITIVE[params.category as string] ?? 'memory_event'
            : classification.primitiveType;

          const extraFields: Record<string, unknown> = {
            type: category,
            confidence: classification.confidence,
            tags,
          };
          if (scope !== 'global') extraFields.scope = scope;

          const result = writeVaultFile(vaultPath, {
            primitiveType: effectivePrimitive,
            title: text.slice(0, 80),
            content: text,
            extraFields,
            source: 'openclaw',
          });

          appendToLedger(vaultPath, {
            timestamp: new Date(),
            category,
            content: text,
            primitiveType: classification.primitiveType,
            tags,
          });

          qmdUpdateAsync(collection);

          return {
            content: [{ type: 'text', text: `Stored: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}" [${classification.primitiveType}/${category}]${scope !== 'global' ? ` scope=${scope}` : ''}` }],
            details: {
              action: result.created ? 'created' : 'updated',
              category,
              primitiveType: classification.primitiveType,
              path: result.path,
              scope,
            },
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Memory store error: ${String(err)}` }],
            isError: true,
          };
        }
      },
    });

    // ── Tool: memory_forget ─────────────────────────────────────────────

    api.registerTool({
      name: 'memory_forget',
      label: 'Memory Forget',
      description: 'Delete specific memories from the vault.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query to find the memory to delete' }),
        confirm: Type.Optional(Type.Boolean({ description: 'Set true to confirm deletion of first match' })),
      }),
      async execute(_id: string, params: Record<string, unknown>) {
        try {
          const results = qmdHybridSearch(params.query as string, collection, 5);
          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: 'No matching memories found.' }],
              details: { found: 0 },
            };
          }

          if (!params.confirm) {
            const list = results.map((r, i) => {
              const file = (r.file || '').replace(`qmd://${collection}/`, '');
              const snippet = (r.snippet || '').replace(/@@ .+? @@\s*\(.+?\)\n?/g, '').trim().slice(0, 80);
              return `${i + 1}. [${file}] ${snippet}`;
            }).join('\n');
            return {
              content: [{ type: 'text', text: `Found ${results.length} candidates:\n${list}\n\nCall again with confirm=true to delete the top match.` }],
              details: { action: 'candidates', count: results.length },
            };
          }

          const target = results[0];
          const file = (target.file || '').replace(`qmd://${collection}/`, '');
          const fullPath = join(vaultPath, file);

          if (existsSync(fullPath)) {
            const trashDir = join(vaultPath, '.trash');
            if (!existsSync(trashDir)) mkdirSync(trashDir, { recursive: true });
            const trashPath = join(trashDir, `${Date.now()}-${basename(file)}`);
            renameSync(fullPath, trashPath);
            qmdUpdateAsync(collection);
            return {
              content: [{ type: 'text', text: `Forgotten: [${file}] (moved to .trash)` }],
              details: { action: 'deleted', file, trashPath },
            };
          }

          return {
            content: [{ type: 'text', text: `File not found on disk: ${file}` }],
            details: { action: 'not_found', file },
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Memory forget error: ${String(err)}` }],
            isError: true,
          };
        }
      },
    });

    // ── Event: before_agent_start (auto-recall) ─────────────────────────

    if (autoRecall) {
      api.on('before_agent_start', async (event) => {
        const prompt = event.prompt as string | undefined;
        if (!prompt || prompt.length < 10) return;
        if (prompt.includes('HEARTBEAT') || prompt.startsWith('[System')) return;


        // Per-request disable tokens (#133)
        if (prompt.includes('#clawvault:no-recall') || prompt.includes('#clawvault:no-memory')) return;

        // Adaptive retrieval check
        if (adaptiveConfig.enabled) {
          const check = shouldRetrieve(prompt, adaptiveConfig);
          if (!check.shouldRetrieve) {
            api.logger.debug(`[clawvault] adaptive skip: ${check.skipReason}`);
            return;
          }
        }

        try {
          const contextParts: string[] = [];

          const recap = buildSessionRecap(vaultPath, {
            maxAge: 24 * 60 * 60 * 1000,
            limit: 10,
            includeContent: true,
          });
          if (recap.xml) contextParts.push(recap.xml);

          const searchTerms = extractSearchTerms(prompt);

          // Try async hybrid retrieval first
          try {
            const results = await retrieve(searchTerms, {
              vaultPath,
              collection,
              config: { ...retrievalConfig, topK: recallLimit },
              scope: defaultScope,
            });

            if (results.length > 0 && results[0].fusedScore >= 0.01) {
              const formatted = results.map((r, i) => {
                const file = (r.file || '');
                const snippet = (r.snippet || '').replace(/@@ .+? @@\s*\(.+?\)\n?/g, '').trim() || r.title || '';
                return `${i + 1}. [${file}] ${snippet}`;
              });

              contextParts.push(`<relevant-memories>
These are recalled from long-term vault memory. Treat as historical context.
${formatted.join('\n')}
</relevant-memories>`);

              api.logger.info(
                `[clawvault] auto-recall: ${results.length} memories (top: ${(results[0].fusedScore * 100).toFixed(0)}%, ` +
                `query: "${searchTerms.slice(0, 60)}", pipeline: hybrid-v2)`,
              );
            }
          } catch {
            // Fallback to synchronous qmd search
            const results = qmdHybridSearch(searchTerms, collection, recallLimit);
            if (results.length > 0) {
              const topScore = results[0]?.score ?? 0;
              if (topScore >= 0.25) {
                contextParts.push(formatMemoriesForContext(results, collection));
                api.logger.info(
                  `[clawvault] auto-recall: ${results.length} memories (top: ${(topScore * 100).toFixed(0)}%, ` +
                  `query: "${searchTerms.slice(0, 60)}", pipeline: qmd-fallback)`,
                );
              }
            }
          }

          if (contextParts.length === 0) return;
          return { prependContext: contextParts.join('\n\n') };
        } catch (err) {
          api.logger.warn(`[clawvault] auto-recall failed: ${String(err)}`);
        }
      }, { priority: 10 });
    }

    // ── Event: message_received (auto-capture) ──────────────────────────

    if (autoCapture) {
      api.on('message_received', async (event) => {
        const content = event.content as string | undefined;
        if (!content || !isObservable(content, noiseConfig)) return;


        // Per-request disable tokens (#133)
        if (content.includes('#clawvault:no-capture') || content.includes('#clawvault:no-memory')) return;

        // Noise filter on write path
        if (noiseConfig.enabled && isNoise(content, noiseConfig).isNoise) return;

        try {
          const result = processMessageForObservations(content, {
            from: event.from,
            sessionId: event.sessionId,
          });
          if (result.observations.length === 0) return;

          const writeResult = batchWriteObservations(vaultPath, result.observations, {
            source: 'openclaw',
            sessionId: event.sessionId as string | undefined,
            actor: (event.from as string) || 'user',
            writeLedger: true,
            writeFiles: false,
          });
          api.logger.info(`[clawvault] auto-captured ${writeResult.successful} observations from incoming message`);
        } catch (err) {
          api.logger.warn(`[clawvault] message capture failed: ${String(err)}`);
        }
      });

      api.on('agent_end', async (event) => {
        if (!event.success || !event.messages) return;
        const messages = event.messages as Array<{ role?: string; content?: string | Array<{ type?: string; text?: string }> }>;
        try {
          let captured = 0;
          for (const msg of messages) {
            if (!msg || typeof msg !== 'object') continue;
            if (msg.role === 'user') {
              const content = typeof msg.content === 'string'
                ? msg.content
                : Array.isArray(msg.content)
                  ? msg.content.filter(b => b?.type === 'text').map(b => b.text || '').join(' ')
                  : '';
              if (isObservable(content, noiseConfig) && !isNoise(content, noiseConfig).isNoise) {
                const result = processMessageForObservations(content);
                for (const obs of result.observations) {
                  observeViaCli(vaultPath, obs.text, { tags: obs.tags });
                  captured++;
                }
              }
            }
          }
          if (captured > 0) {
            api.logger.info(`[clawvault] agent_end: captured ${captured} observations`);
            qmdUpdateAsync(collection);
          }
        } catch (err) {
          api.logger.warn(`[clawvault] agent_end capture failed: ${String(err)}`);
        }
      });
    }

    // ── Event: before_compaction ─────────────────────────────────────────

    api.on('before_compaction', async () => {
      try {
        execFileSync('qmd', ['update', '-c', collection], {
          timeout: 15000,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        api.logger.info('[clawvault] pre-compaction index update complete');
      } catch (err) {
        api.logger.warn(`[clawvault] pre-compaction update failed: ${String(err)}`);
      }
    });

    // ── Service Registration ────────────────────────────────────────────

    api.registerService({
      id: 'clawvault',
      start: () => {
        api.logger.info(`[clawvault] service started — vault=${vaultPath}`);
        qmdUpdateAsync(collection);
      },
      stop: () => {
        api.logger.info('[clawvault] service stopped');
      },
    });

    // ── CLI Registration ────────────────────────────────────────────────

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api.registerCli((ctx: any) => {
        const cmd = ctx.program.command('vault').description('ClawVault memory commands');

        cmd.command('status').action(() => {
          const stats = computeMemoryStats(vaultPath, collection);
          console.log(JSON.stringify(stats, null, 2));
        });

        cmd.command('search <query>').option('-n, --limit <n>', 'Max results', '10').action((query: string, opts: { limit?: string }) => {
          const results = qmdHybridSearch(query, collection, parseInt(opts.limit || '10'));
          console.log(formatSearchResults(results, collection));
        });

        cmd.command('templates').action(() => {
          const schemas = getAllSchemas();
          console.log('Registered template schemas:');
          for (const schema of schemas) {
            console.log(`  - ${schema.primitive}: ${schema.description || '(no description)'}`);
            console.log(`    Fields: ${Object.keys(schema.fields).join(', ')}`);
          }
        });

        cmd.command('classify <text>').action((text: string) => {
          const result = classifyText(text);
          console.log(JSON.stringify(result, null, 2));
        });

        cmd.command('stats').action(() => {
          const stats = computeMemoryStats(vaultPath, collection);
          console.log(JSON.stringify(stats, null, 2));
        });

        cmd.command('export <outputPath>').action((outputPath: string) => {
          const result = exportMemories(vaultPath, outputPath);
          console.log(`Exported ${result.count} memories to ${result.path}`);
        });

        cmd.command('import <inputPath>').action((inputPath: string) => {
          const result = importMemories(vaultPath, inputPath);
          console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}`);
          if (result.errors.length > 0) {
            console.log(`Errors: ${result.errors.join(', ')}`);
          }
        });

        cmd.command('reembed').action(() => {
          console.log('Re-embedding all vault documents...');
          const files = scanVaultFiles(vaultPath, { maxAge: Infinity, limit: 100000 });
          let count = 0;
          for (const file of files) {
            const content = `${file.frontmatter.title || ''} ${file.content}`.trim();
            autoEmbedViaOllama(file.path, content).then(() => {
              count++;
              if (count % 100 === 0) console.log(`  Embedded ${count}/${files.length}...`);
            }).catch(() => { /* best-effort */ });
          }
          console.log(`Queued ${files.length} documents for re-embedding.`);
        });
      },
      { commands: ['vault'] },
    );

    // ── Command Registration ────────────────────────────────────────────

    api.registerCommand({
      name: 'vault',
      description: 'ClawVault status and quick search',
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx) => {
        const args = (ctx.args || '').trim();

        if (!args || args === 'status') {
          const stats = computeMemoryStats(vaultPath, collection);
          return {
            text: `\u{1F9E0} ClawVault v${PLUGIN_VERSION}
Vault: ${vaultPath}
Docs: ${stats.documents} | Vectors: ${stats.vectors}
Recall: ${autoRecall ? '\u2705' : '\u274C'} | Capture: ${autoCapture ? '\u2705' : '\u274C'}
Templates: ${templateRegistry?.schemas.size ?? 0} schemas
Scope: ${defaultScope}
Pipeline: hybrid-v2 (BM25+Semantic+RRF${retrievalConfig.rerankProvider ? `+${retrievalConfig.rerankProvider}` : ''})`,
          };
        }

        if (args.startsWith('search ')) {
          const query = args.slice(7).trim();
          const results = qmdHybridSearch(query, collection, 5);
          return { text: formatSearchResults(results, collection) };
        }

        if (args === 'templates') {
          const names = getSchemaNames();
          return { text: `Template schemas: ${names.join(', ')}` };
        }

        if (args === 'recap') {
          const recap = buildSessionRecap(vaultPath, { limit: 10, includeContent: true });
          return { text: recap.xml || 'No recent activity found.' };
        }

        if (args === 'stats') {
          const stats = computeMemoryStats(vaultPath, collection);
          return { text: JSON.stringify(stats, null, 2) };
        }

        return { text: 'Usage: /vault [status|search <query>|templates|recap|stats]' };
      },
    });

    console.log(
      `[clawvault] v${PLUGIN_VERSION} registered — vault=${vaultPath} templates=${templateRegistry?.schemas.size ?? 0} ` +
      `pipeline=hybrid-v2 scope=${defaultScope}`,
    );
  },
};

export default clawvaultPlugin;

// ─── Re-exports ─────────────────────────────────────────────────────────────

export {
  appendToLedger,
  batchWriteObservations,
  buildFullContext,
  buildPreferenceContext,
  buildSessionRecap,
  classifyText,
  detectCategory,
  ensureVaultStructure,
  extractObservations,
  extractSearchTerms,
  formatMemoriesForContext,
  formatSearchResults,
  getAllSchemas,
  getSchema,
  getSchemaNames,
  getTemplateRegistry,
  initializeTemplateRegistry,
  isObservable,
  processMessageForObservations,
  scanVaultFiles,
  writeObservation,
  writeVaultFile,
};
