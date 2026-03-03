/**
 * ClawVault Plugin v2 — Context Injection
 *
 * Scans vault files and builds context for session injection:
 * - Session recaps (recent activity)
 * - Preference context
 * - Memory formatting for LLM consumption
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import type {
  VaultFile, ScanOptions, SessionRecapResult,
  PreferenceContextResult, QmdResult,
} from './types.js';

// ─── Simple YAML Parser (self-contained for inject) ────────────────────────

function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  try {
    const frontmatter = parseSimpleYaml(match[1]);
    return { frontmatter, body: match[2] };
  } catch {
    return null;
  }
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of yaml.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const valueStr = line.slice(colonIndex + 1).trim();
    if (valueStr === '' || valueStr.startsWith('|') || valueStr.startsWith('>')) continue;
    result[key] = parseYamlValue(valueStr);
  }
  return result;
}

function parseYamlValue(value: string): unknown {
  if (value === '' || value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// ─── Vault Scanning ────────────────────────────────────────────────────────

export function scanVaultFiles(vaultPath: string, options: ScanOptions = {}): VaultFile[] {
  const files: VaultFile[] = [];
  const maxAge = options.maxAge ?? 7 * 24 * 60 * 60 * 1000;
  const limit = options.limit ?? 100;
  const now = Date.now();
  const cutoff = now - maxAge;

  const dirsToScan = findVaultDirectories(vaultPath);
  for (const dir of dirsToScan) {
    if (!existsSync(dir)) continue;
    try {
      scanDirectory(dir, vaultPath, files, cutoff, options.primitiveTypes);
    } catch {
      // skip inaccessible directories
    }
  }

  files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return files.slice(0, limit);
}

function findVaultDirectories(vaultPath: string): string[] {
  const dirs = [vaultPath];
  const commonDirs = [
    'tasks', 'projects', 'decisions', 'people', 'persons',
    'notes', 'daily', 'journal', 'ledger', 'memory', 'memories',
    'observations', 'lessons', 'triggers', 'runs', 'checkpoints',
    'handoffs', 'workspaces', 'parties',
  ];

  for (const subdir of commonDirs) {
    const fullPath = join(vaultPath, subdir);
    if (existsSync(fullPath)) dirs.push(fullPath);
  }

  try {
    const entries = readdirSync(vaultPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
        const fullPath = join(vaultPath, entry.name);
        if (!dirs.includes(fullPath)) dirs.push(fullPath);
      }
    }
  } catch {
    // can't read vault root
  }

  return dirs;
}

function scanDirectory(
  dir: string,
  vaultPath: string,
  files: VaultFile[],
  cutoff: number,
  primitiveTypes?: string[],
): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const depth = fullPath.replace(vaultPath, '').split('/').length;
      if (depth <= 3) {
        scanDirectory(fullPath, vaultPath, files, cutoff, primitiveTypes);
      }
    } else if (entry.name.endsWith('.md')) {
      try {
        const stat = statSync(fullPath);
        if (stat.mtimeMs < cutoff) continue;

        const content = readFileSync(fullPath, 'utf-8');
        const parsed = parseYamlFrontmatter(content);
        if (!parsed) continue;

        const primitiveType = detectPrimitiveType(parsed.frontmatter, fullPath);
        if (primitiveTypes && !primitiveTypes.includes(primitiveType)) continue;

        files.push({
          path: fullPath,
          relativePath: relative(vaultPath, fullPath),
          primitiveType,
          frontmatter: parsed.frontmatter,
          content: parsed.body,
          modifiedAt: stat.mtime,
          createdAt: stat.birthtime,
        });
      } catch {
        // skip unreadable files
      }
    }
  }
}

function detectPrimitiveType(frontmatter: Record<string, unknown>, filePath: string): string {
  if (frontmatter.primitive) return String(frontmatter.primitive);
  if (frontmatter.type) return String(frontmatter.type);

  const pathLower = filePath.toLowerCase();
  const pathMap: Record<string, string> = {
    '/tasks/': 'task',
    '/projects/': 'project',
    '/decisions/': 'decision',
    '/people/': 'person',
    '/persons/': 'person',
    '/daily/': 'daily-note',
    '/journal/': 'daily-note',
    '/lessons/': 'lesson',
    '/triggers/': 'trigger',
    '/runs/': 'run',
    '/checkpoints/': 'checkpoint',
    '/handoffs/': 'handoff',
    '/ledger/': 'memory_event',
    '/memory/': 'memory_event',
    '/memories/': 'memory_event',
  };

  for (const [segment, type] of Object.entries(pathMap)) {
    if (pathLower.includes(segment)) return type;
  }

  return 'unknown';
}

// ─── Session Recap ──────────────────────────────────────────────────────────

export function buildSessionRecap(
  vaultPath: string,
  options: { maxAge?: number; limit?: number; includeContent?: boolean } = {},
): SessionRecapResult {
  const maxAge = options.maxAge ?? 24 * 60 * 60 * 1000;
  const limit = options.limit ?? 20;
  const includeContent = options.includeContent ?? false;

  const files = scanVaultFiles(vaultPath, { maxAge, limit });

  if (files.length === 0) {
    return { xml: '', fileCount: 0, primitiveGroups: {}, timeRange: null };
  }

  const groups: Record<string, VaultFile[]> = {};
  for (const file of files) {
    const type = file.primitiveType;
    if (!groups[type]) groups[type] = [];
    groups[type].push(file);
  }

  const lines = ['<session-recap>'];
  lines.push(`<summary>Found ${files.length} recent items across ${Object.keys(groups).length} categories</summary>`);

  for (const [primitiveType, groupFiles] of Object.entries(groups)) {
    lines.push(`<${primitiveType}-items count="${groupFiles.length}">`);
    for (const file of groupFiles.slice(0, 5)) {
      const title = file.frontmatter.title || file.frontmatter.summary || file.relativePath;
      const status = file.frontmatter.status || '';
      const modified = file.modifiedAt.toISOString().slice(0, 16).replace('T', ' ');
      lines.push(`  <item path="${file.relativePath}" modified="${modified}"${status ? ` status="${String(status)}"` : ''}>`);
      lines.push(`    <title>${escapeXml(String(title))}</title>`);
      if (includeContent && file.content) {
        const snippet = file.content.slice(0, 200).replace(/\n/g, ' ').trim();
        if (snippet) {
          lines.push(`    <snippet>${escapeXml(snippet)}</snippet>`);
        }
      }
      lines.push('  </item>');
    }
    if (groupFiles.length > 5) {
      lines.push(`  <more count="${groupFiles.length - 5}" />`);
    }
    lines.push(`</${primitiveType}-items>`);
  }
  lines.push('</session-recap>');

  const sortedByTime = [...files].sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime());
  const timeRange = {
    oldest: sortedByTime[0].modifiedAt,
    newest: sortedByTime[sortedByTime.length - 1].modifiedAt,
  };

  const primitiveGroups: Record<string, number> = {};
  for (const [type, groupFiles] of Object.entries(groups)) {
    primitiveGroups[type] = groupFiles.length;
  }

  return { xml: lines.join('\n'), fileCount: files.length, primitiveGroups, timeRange };
}

// ─── Preference Context ────────────────────────────────────────────────────

export function buildPreferenceContext(
  vaultPath: string,
  options: { maxAge?: number; limit?: number } = {},
): PreferenceContextResult {
  const maxAge = options.maxAge ?? 30 * 24 * 60 * 60 * 1000;
  const limit = options.limit ?? 50;

  const files = scanVaultFiles(vaultPath, { maxAge, limit: limit * 2 });
  const preferenceFiles = files.filter(file => {
    if (file.frontmatter.type === 'preference') return true;
    if (file.primitiveType === 'memory_event' && file.frontmatter.type === 'preference') return true;
    const content = (file.content || '').toLowerCase();
    return /\b(prefer|like|love|hate|dislike|want|need|always|never)\b/.test(content);
  }).slice(0, limit);

  if (preferenceFiles.length === 0) {
    return { xml: '', preferenceCount: 0, categories: [] };
  }

  const categories = new Set<string>();
  for (const file of preferenceFiles) {
    if (file.frontmatter.category) categories.add(String(file.frontmatter.category));
  }

  const lines = ['<user-preferences>'];
  for (const file of preferenceFiles) {
    const summary = file.frontmatter.summary || file.frontmatter.title || extractPreferenceSummary(file.content);
    if (!summary) continue;
    const category = file.frontmatter.category || 'general';
    const sentiment = file.frontmatter.sentiment || inferSentiment(file.content);
    lines.push(`  <preference category="${escapeXml(String(category))}" sentiment="${String(sentiment)}">`);
    lines.push(`    ${escapeXml(String(summary))}`);
    lines.push('  </preference>');
  }
  lines.push('</user-preferences>');

  return {
    xml: lines.join('\n'),
    preferenceCount: preferenceFiles.length,
    categories: Array.from(categories),
  };
}

function extractPreferenceSummary(content: string): string {
  if (!content) return '';
  const sentences = content.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);
  for (const sentence of sentences) {
    if (/\b(prefer|like|love|hate|dislike|want|need|always|never)\b/i.test(sentence)) {
      return sentence.slice(0, 150);
    }
  }
  return sentences[0]?.slice(0, 150) || '';
}

function inferSentiment(content: string): string {
  if (!content) return 'neutral';
  const lower = content.toLowerCase();
  if (/\b(love|like|prefer|enjoy|want|need|always)\b/.test(lower)) return 'positive';
  if (/\b(hate|dislike|don't like|never|avoid)\b/.test(lower)) return 'negative';
  return 'neutral';
}

// ─── Memory Formatting ─────────────────────────────────────────────────────

export function formatMemoriesForContext(results: QmdResult[], collection: string): string {
  if (results.length === 0) return '';

  const lines = results.map((r, i) => {
    const file = (r.file || '').replace(`qmd://${collection}/`, '');
    const snippet = (r.snippet || '').replace(/@@ .+? @@\s*\(.+?\)\n?/g, '').trim() || r.title || '';
    return `${i + 1}. [${file}] ${snippet}`;
  });

  return `<relevant-memories>
These are recalled from long-term vault memory. Treat as historical context.
${lines.join('\n')}
</relevant-memories>`;
}

export function formatSearchResults(results: QmdResult[], collection: string): string {
  if (results.length === 0) return 'No relevant memories found.';
  return results.map((r, i) => {
    const file = (r.file || '').replace(`qmd://${collection}/`, '');
    const snippet = (r.snippet || '').replace(/@@ .+? @@\s*\(.+?\)\n?/g, '').trim() || r.title || '(no content)';
    const score = ((r.score ?? 0) * 100).toFixed(0);
    return `${i + 1}. [${file}] ${snippet} (${score}%)`;
  }).join('\n');
}

// ─── Full Context Builder ───────────────────────────────────────────────────

export function buildFullContext(
  vaultPath: string,
  options: {
    includeRecap?: boolean;
    includePreferences?: boolean;
    recapMaxAge?: number;
    preferenceMaxAge?: number;
  } = {},
): string {
  const parts: string[] = [];

  if (options.includeRecap !== false) {
    const recap = buildSessionRecap(vaultPath, {
      maxAge: options.recapMaxAge ?? 24 * 60 * 60 * 1000,
      limit: 15,
      includeContent: true,
    });
    if (recap.xml) parts.push(recap.xml);
  }

  if (options.includePreferences !== false) {
    const prefs = buildPreferenceContext(vaultPath, {
      maxAge: options.preferenceMaxAge ?? 30 * 24 * 60 * 60 * 1000,
      limit: 20,
    });
    if (prefs.xml) parts.push(prefs.xml);
  }

  return parts.join('\n\n');
}

// ─── Utilities ──────────────────────────────────────────────────────────────

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
