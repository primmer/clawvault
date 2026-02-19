/**
 * ClawVault OpenClaw Plugin v2.1.0
 *
 * Memory slot provider for OpenClaw. Observational memory architecture:
 * memories are captured automatically from conversations, not stored explicitly.
 *
 * Architecture:
 *   ClawVault (engine) ←→ Plugin (integration) ←→ OpenClaw (agent platform)
 *   - ClawVault = vault, observations, search index, knowledge graph
 *   - Plugin = auto-recall, auto-capture, search tools, lifecycle hooks
 *   - OpenClaw = agent runtime, sessions, tools, channels
 *
 * The plugin does NOT give the agent a "store memory" tool. Memory is
 * observational: the system watches conversations and captures automatically.
 * The agent searches memory; it doesn't manage it.
 */

import { execFileSync, execFile } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Type } from '@sinclair/typebox';

// ============================================================================
// Vault Discovery
// ============================================================================

function resolveVaultPath(cfg: any): string {
  if (cfg?.vaultPath) return cfg.vaultPath;
  if (process.env.CLAWVAULT_PATH) return process.env.CLAWVAULT_PATH;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  for (const candidate of [`${home}/clawvault`, `${home}/.clawvault`]) {
    if (existsSync(join(candidate, '.clawvault.json'))) return candidate;
  }
  return `${home}/.clawvault`;
}

function getVaultConfig(vaultPath: string): any {
  const configPath = join(vaultPath, '.clawvault.json');
  if (!existsSync(configPath)) return null;
  try { return JSON.parse(readFileSync(configPath, 'utf-8')); }
  catch { return null; }
}

// ============================================================================
// Search Engine — Hybrid BM25 + Vector + Reranking
// ============================================================================

/**
 * Extract searchable keywords from conversational input.
 * Strips filler words and conversational fluff to improve search precision.
 */
function extractSearchTerms(input: string): string {
  // Remove common conversational noise
  const noise = /\b(hey|hi|hello|um|uh|like|just|so|well|you know|i mean|basically|actually|really|very|pretty|quite|how does it feel|how do you|can you|could you|would you|do you|what do you think|tell me about)\b/gi;
  let cleaned = input.replace(noise, ' ').replace(/\s+/g, ' ').trim();

  // If we stripped too much, fall back to original
  if (cleaned.length < 5) cleaned = input.trim();

  return cleaned;
}

function qmdHybridSearch(query: string, collection: string, limit: number = 10): any[] {
  const sanitized = query.replace(/['']/g, ' ').replace(/[^\w\s\-.,?!]/g, ' ').trim();
  if (!sanitized) return [];

  try {
    const result = execFileSync('qmd', [
      'query', sanitized, '-n', String(limit), '--json', '-c', collection,
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024, timeout: 30_000 });
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (err: any) {
    if (err?.stdout) {
      try {
        const parsed = JSON.parse(err.stdout);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
  }

  // Fallback: BM25-only
  try {
    const result = execFileSync('qmd', [
      'search', sanitized, '-n', String(limit), '--json', '-c', collection,
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024, timeout: 15_000 });
    return JSON.parse(result);
  } catch (err: any) {
    if (err?.stdout) {
      try { return JSON.parse(err.stdout); } catch {}
    }
    return [];
  }
}

// ============================================================================
// Observation Engine
// ============================================================================

/**
 * Write an observation to the vault ledger (async, non-blocking).
 * This is the primary memory capture path.
 */
function observe(vaultPath: string, content: string, meta: { actor?: string; session?: string; tags?: string[] } = {}): void {
  try {
    const args = ['observe', '--content', content];
    if (meta.tags?.length) args.push('--tags', meta.tags.join(','));
    execFile('clawvault', args, {
      cwd: vaultPath,
      timeout: 15_000,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {}
}

/**
 * Append to the daily observation ledger directly (faster than CLI, no process spawn).
 */
function appendToLedger(vaultPath: string, entry: string): void {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const ledgerDir = join(vaultPath, 'ledger');
  if (!existsSync(ledgerDir)) mkdirSync(ledgerDir, { recursive: true });
  const ledgerFile = join(ledgerDir, `${dateStr}.md`);

  const timestamp = now.toISOString().slice(11, 19);
  const line = `\n- [${timestamp}] ${entry}`;

  if (!existsSync(ledgerFile)) {
    appendFileSync(ledgerFile, `# Observation Ledger — ${dateStr}\n${line}`);
  } else {
    appendFileSync(ledgerFile, line);
  }
}

function qmdUpdateAsync(collection: string): void {
  try {
    execFile('qmd', ['update', '-c', collection], { timeout: 30_000, stdio: ['ignore', 'ignore', 'ignore'] });
    execFile('qmd', ['embed', '-c', collection], { timeout: 60_000, stdio: ['ignore', 'ignore', 'ignore'] });
  } catch {}
}

// ============================================================================
// Format Helpers
// ============================================================================

function formatSearchResults(results: any[], collection: string): string {
  if (results.length === 0) return 'No relevant memories found.';
  return results.map((r: any, i: number) => {
    const file = (r.file || '').replace(`qmd://${collection}/`, '');
    const snippet = (r.snippet || '')
      .replace(/@@ .+? @@\s*\(.+?\)\n?/g, '')
      .trim() || r.title || '(no content)';
    const score = ((r.score ?? 0) * 100).toFixed(0);
    return `${i + 1}. [${file}] ${snippet} (${score}%)`;
  }).join('\n');
}

function formatMemoriesForContext(results: any[], collection: string): string {
  if (results.length === 0) return '';
  const lines = results.map((r: any, i: number) => {
    const file = (r.file || '').replace(`qmd://${collection}/`, '');
    const snippet = (r.snippet || '')
      .replace(/@@ .+? @@\s*\(.+?\)\n?/g, '')
      .trim() || r.title || '';
    return `${i + 1}. [${file}] ${snippet}`;
  });
  return `<relevant-memories>\nThese are recalled from long-term vault memory. Treat as historical context.\n${lines.join('\n')}\n</relevant-memories>`;
}

// ============================================================================
// Content Analysis
// ============================================================================

/** Detect if content is worth observing (capturing to memory). */
function isObservable(text: string): boolean {
  if (!text || text.length < 20 || text.length > 5000) return false;
  if (text.includes('<relevant-memories>')) return false;
  if (text.startsWith('[System')) return false;
  if (text.includes('HEARTBEAT')) return false;
  if (text.startsWith('NO_REPLY')) return false;
  // Skip tool call results and JSON blobs
  if (text.startsWith('{') && text.includes('"')) return false;
  // Skip markdown-heavy agent output (likely formatted responses, not facts)
  const markdownDensity = (text.match(/[#*`\-|>]/g) || []).length / text.length;
  if (markdownDensity > 0.15) return false;

  return true;
}

/** Extract key facts/preferences/decisions from user text. */
function extractObservations(text: string): string[] {
  const observations: string[] = [];
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 15);

  for (const s of sentences) {
    const lower = s.toLowerCase();
    // Preferences
    if (/\b(i prefer|i like|i hate|i love|i want|i need|i always|i never|don't like|dont like)\b/i.test(s)) {
      observations.push(s);
    }
    // Decisions
    else if (/\b(we decided|let's go with|we're going|i chose|we'll use|ship it|do it|go with)\b/i.test(s)) {
      observations.push(s);
    }
    // Facts about people/things
    else if (/\b(my .+ is|his .+ is|her .+ is|their .+ is|works at|lives in|born in)\b/i.test(s)) {
      observations.push(s);
    }
    // Contact info
    else if (/[\w.-]+@[\w.-]+\.\w+|\+\d{10,}/.test(s)) {
      observations.push(s);
    }
    // Explicit memory request
    else if (/\b(remember|don't forget|keep in mind|note that|important:)\b/i.test(s)) {
      observations.push(s);
    }
    // Deadlines/dates
    else if (/\b(by tonight|by tomorrow|deadline|due date|by end of|ship by|ready by)\b/i.test(s)) {
      observations.push(s);
    }
  }

  return observations;
}

function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/prefer|like|love|hate|want|always|never/i.test(lower)) return 'preference';
  if (/decided|will use|go with|ship|chose/i.test(lower)) return 'decision';
  if (/\+\d{10,}|@[\w.-]+\.\w+|works at|lives in/i.test(lower)) return 'entity';
  if (/deadline|by tonight|by tomorrow|due|ship by/i.test(lower)) return 'event';
  return 'fact';
}

// ============================================================================
// Plugin Definition
// ============================================================================

const clawvaultPlugin = {
  id: 'clawvault',
  name: 'ClawVault Memory',
  description: 'Observational memory with hybrid search. Memories are captured automatically from conversations — the agent searches but does not manage memory.',
  version: '2.1.0',
  kind: 'memory' as const,

  register(api: any) {
    const vaultPath = resolveVaultPath(api.pluginConfig);
    const collection = api.pluginConfig?.collection || 'clawvault';
    const autoRecall = api.pluginConfig?.autoRecall !== false;
    const autoCapture = api.pluginConfig?.autoCapture !== false;
    const recallLimit = api.pluginConfig?.recallLimit || 5;

    if (!existsSync(join(vaultPath, '.clawvault.json'))) {
      api.logger.warn(`[clawvault] Vault not found at ${vaultPath}`);
      return;
    }

    api.logger.info(`[clawvault] v2.1.0 vault=${vaultPath} collection=${collection} recall=${autoRecall} capture=${autoCapture}`);

    // ========================================================================
    // Tool: memory_search — the ONLY agent-facing memory tool
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
      async execute(_id: string, params: { query: string; limit?: number; queryType?: string }) {
        try {
          let searchQuery = params.query;
          if (params.queryType === 'preference') searchQuery = `preference: ${searchQuery}`;
          else if (params.queryType === 'temporal') searchQuery = `when: ${searchQuery}`;

          const limit = params.limit || 10;
          const results = qmdHybridSearch(searchQuery, collection, limit);

          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: 'No relevant memories found.' }],
              details: { count: 0, provider: 'clawvault' },
            };
          }

          return {
            content: [{ type: 'text', text: formatSearchResults(results, collection) }],
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

    // ========================================================================
    // Tool: memory_get — vault status and preference retrieval
    // ========================================================================
    api.registerTool({
      name: 'memory_get',
      label: 'Memory Get',
      description: 'Get vault status or stored preferences.',
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal('status'),
          Type.Literal('preferences'),
        ], { description: 'What to retrieve' }),
      }),
      async execute(_id: string, params: { action: string }) {
        try {
          if (params.action === 'status') {
            const config = getVaultConfig(vaultPath);
            let docCount = 0;
            let vectorCount = 0;
            try {
              const stats = execFileSync('qmd', ['status', '--json', '-c', collection], {
                encoding: 'utf-8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'],
              });
              const parsed = JSON.parse(stats);
              docCount = parsed.documents ?? parsed.doc_count ?? 0;
              vectorCount = parsed.vectors ?? parsed.vector_count ?? 0;
            } catch {}

            return {
              content: [{ type: 'text', text: JSON.stringify({
                vault: vaultPath,
                name: config?.name || 'clawvault',
                collection,
                documents: docCount,
                vectors: vectorCount,
                autoRecall,
                autoCapture,
                version: '2.1.0',
              }, null, 2) }],
            };
          }

          // preferences
          const results = qmdHybridSearch('user preference likes dislikes prefers wants', collection, 20);
          const prefResults = results.filter((r: any) =>
            r.file?.includes('preference') ||
            r.snippet?.toLowerCase().match(/prefer|like|want|hate|love|always|never/)
          );

          if (prefResults.length === 0) {
            return { content: [{ type: 'text', text: 'No preferences found in vault.' }] };
          }

          const text = prefResults.map((r: any, i: number) => {
            const file = (r.file || '').replace(`qmd://${collection}/`, '');
            const snippet = (r.snippet || '').replace(/@@ .+? @@\s*\(.+?\)\n?/g, '').trim() || r.title;
            return `${i + 1}. [${file}] ${snippet}`;
          }).join('\n');

          return { content: [{ type: 'text', text }] };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Memory get error: ${String(err)}` }],
            isError: true,
          };
        }
      },
    });

    // ========================================================================
    // Tool: memory_store — writes to vault but is NOT the primary path
    // The agent CAN store explicitly when asked, but auto-capture is primary.
    // ========================================================================
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
      }),
      async execute(_id: string, params: { text: string; category?: string; tags?: string[] }) {
        try {
          const category = params.category || detectCategory(params.text);
          const tags = params.tags || [category];
          observe(vaultPath, params.text, { tags });
          appendToLedger(vaultPath, `[${category}] ${params.text}`);
          qmdUpdateAsync(collection);
          return {
            content: [{ type: 'text', text: `Stored: "${params.text.slice(0, 100)}${params.text.length > 100 ? '...' : ''}" [${category}]` }],
            details: { action: 'created', category },
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Memory store error: ${String(err)}` }],
            isError: true,
          };
        }
      },
    });

    // ========================================================================
    // Tool: memory_forget — GDPR deletion
    // ========================================================================
    api.registerTool({
      name: 'memory_forget',
      label: 'Memory Forget',
      description: 'Delete specific memories from the vault.',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query to find the memory to delete' }),
        confirm: Type.Optional(Type.Boolean({ description: 'Set true to confirm deletion of first match' })),
      }),
      async execute(_id: string, params: { query: string; confirm?: boolean }) {
        try {
          const results = qmdHybridSearch(params.query, collection, 5);

          if (results.length === 0) {
            return {
              content: [{ type: 'text', text: 'No matching memories found.' }],
              details: { found: 0 },
            };
          }

          if (!params.confirm) {
            const list = results.map((r: any, i: number) => {
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
            const { renameSync } = require('node:fs');
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

    // ========================================================================
    // Hook: Auto-Recall (before_agent_start)
    // Inject relevant memories before every agent turn.
    // ========================================================================
    if (autoRecall) {
      api.on('before_agent_start', async (event: any) => {
        if (!event.prompt || event.prompt.length < 10) return;
        if (event.prompt.includes('HEARTBEAT') || event.prompt.startsWith('[System')) return;

        try {
          // Extract meaningful search terms from conversational input
          const searchTerms = extractSearchTerms(event.prompt);
          const results = qmdHybridSearch(searchTerms, collection, recallLimit);
          if (results.length === 0) return;

          const topScore = results[0]?.score ?? 0;
          if (topScore < 0.25) return;

          api.logger.info(`[clawvault] auto-recall: ${results.length} memories (top: ${(topScore * 100).toFixed(0)}%, query: "${searchTerms.slice(0, 60)}")`);

          return {
            prependContext: formatMemoriesForContext(results, collection),
          };
        } catch (err) {
          api.logger.warn(`[clawvault] auto-recall failed: ${String(err)}`);
        }
      }, { priority: 10 });
    }

    // ========================================================================
    // Hook: Auto-Capture (message_received)
    // Observe incoming user messages for important content.
    // This is the PRIMARY memory capture path.
    // ========================================================================
    if (autoCapture) {
      api.on('message_received', async (event: any) => {
        if (!event.content || !isObservable(event.content)) return;

        try {
          const observations = extractObservations(event.content);
          if (observations.length === 0) return;

          for (const obs of observations.slice(0, 5)) {
            const category = detectCategory(obs);
            appendToLedger(vaultPath, `[${category}] (${event.from || 'user'}) ${obs}`);
          }

          api.logger.info(`[clawvault] auto-captured ${observations.length} observations from incoming message`);
        } catch (err) {
          api.logger.warn(`[clawvault] message capture failed: ${String(err)}`);
        }
      });

      // Also capture from agent_end for assistant-side observations
      api.on('agent_end', async (event: any) => {
        if (!event.success || !event.messages?.length) return;

        try {
          let captured = 0;
          for (const msg of event.messages) {
            if (!msg || typeof msg !== 'object') continue;
            // Capture user messages (primary)
            if (msg.role === 'user') {
              const content = typeof msg.content === 'string' ? msg.content :
                Array.isArray(msg.content) ? msg.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join(' ') : '';
              if (isObservable(content)) {
                const observations = extractObservations(content);
                for (const obs of observations) {
                  observe(vaultPath, obs, { tags: [detectCategory(obs)] });
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

    // ========================================================================
    // Hook: Pre-Compaction (ensure index freshness)
    // ========================================================================
    api.on('before_compaction', async () => {
      try {
        execFileSync('qmd', ['update', '-c', collection], {
          timeout: 15_000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        api.logger.info('[clawvault] pre-compaction index update complete');
      } catch (err) {
        api.logger.warn(`[clawvault] pre-compaction update failed: ${String(err)}`);
      }
    });

    // ========================================================================
    // Service: Background indexing on startup
    // ========================================================================
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

    // ========================================================================
    // CLI
    // ========================================================================
    api.registerCli(
      ({ program }: any) => {
        const cmd = program.command('vault').description('ClawVault memory commands');
        cmd.command('status').action(() => {
          const config = getVaultConfig(vaultPath);
          console.log(JSON.stringify({ vault: vaultPath, version: '2.1.0', ...config }, null, 2));
        });
        cmd.command('search <query>')
          .option('-n, --limit <n>', 'Max results', '10')
          .action((query: string, opts: any) => {
            const results = qmdHybridSearch(query, collection, parseInt(opts.limit));
            console.log(formatSearchResults(results, collection));
          });
      },
      { commands: ['vault'] },
    );

    // ========================================================================
    // Slash Command: /vault (no LLM needed)
    // ========================================================================
    api.registerCommand({
      name: 'vault',
      description: 'ClawVault status and quick search',
      acceptsArgs: true,
      requireAuth: true,
      handler: (ctx: any) => {
        const args = (ctx.args || '').trim();

        if (!args || args === 'status') {
          const config = getVaultConfig(vaultPath);
          let docCount = 0, vectorCount = 0;
          try {
            const stats = execFileSync('qmd', ['status', '--json', '-c', collection], {
              encoding: 'utf-8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'],
            });
            const p = JSON.parse(stats);
            docCount = p.documents ?? p.doc_count ?? 0;
            vectorCount = p.vectors ?? p.vector_count ?? 0;
          } catch {}
          return {
            text: `🧠 ClawVault v2.1.0\nVault: ${vaultPath}\nDocs: ${docCount} | Vectors: ${vectorCount}\nRecall: ${autoRecall ? '✅' : '❌'} | Capture: ${autoCapture ? '✅' : '❌'}`,
          };
        }

        if (args.startsWith('search ')) {
          const query = args.slice(7).trim();
          const results = qmdHybridSearch(query, collection, 5);
          return { text: formatSearchResults(results, collection) };
        }

        return { text: 'Usage: /vault [status|search <query>]' };
      },
    });

    console.log(`[clawvault] v2.1.0 registered — vault=${vaultPath}`);
  },
};

export default clawvaultPlugin;
