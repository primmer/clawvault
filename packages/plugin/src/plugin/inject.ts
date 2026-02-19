/**
 * Dynamic Context Injection for ClawVault
 *
 * Builds session recaps and preference context by dynamically scanning
 * the vault instead of using hardcoded paths. Groups files by primitive
 * type and builds context XML for injection.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getSchemaNames, getSchema } from './templates.js';

// ============================================================================
// Types
// ============================================================================

export interface VaultFile {
  path: string;
  relativePath: string;
  primitiveType: string;
  frontmatter: Record<string, unknown>;
  content: string;
  modifiedAt: Date;
  createdAt: Date;
}

export interface SessionRecap {
  xml: string;
  fileCount: number;
  primitiveGroups: Record<string, number>;
  timeRange: { oldest: Date; newest: Date } | null;
}

export interface PreferenceContext {
  xml: string;
  preferenceCount: number;
  categories: string[];
}

// ============================================================================
// YAML Frontmatter Parser (lightweight)
// ============================================================================

function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const yamlContent = match[1];
  const body = match[2];

  try {
    const frontmatter = parseSimpleYaml(yamlContent);
    return { frontmatter, body };
  } catch {
    return null;
  }
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');

  for (const line of lines) {
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
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// ============================================================================
// Vault Scanning
// ============================================================================

export function scanVaultFiles(
  vaultPath: string,
  options: {
    maxAge?: number;
    limit?: number;
    primitiveTypes?: string[];
  } = {}
): VaultFile[] {
  const files: VaultFile[] = [];
  const maxAge = options.maxAge ?? 7 * 24 * 60 * 60 * 1000; // 7 days default
  const limit = options.limit ?? 100;
  const now = Date.now();
  const cutoff = now - maxAge;

  // Directories to scan (dynamic based on what exists)
  const dirsToScan = findVaultDirectories(vaultPath);

  for (const dir of dirsToScan) {
    if (!existsSync(dir)) continue;

    try {
      scanDirectory(dir, vaultPath, files, cutoff, options.primitiveTypes);
    } catch {
      // Skip directories we can't read
    }
  }

  // Sort by modified time (newest first)
  files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  // Apply limit
  return files.slice(0, limit);
}

function findVaultDirectories(vaultPath: string): string[] {
  const dirs: string[] = [];

  // Always check root
  dirs.push(vaultPath);

  // Check for common vault subdirectories
  const commonDirs = [
    'tasks',
    'projects',
    'decisions',
    'people',
    'persons',
    'notes',
    'daily',
    'journal',
    'ledger',
    'memory',
    'memories',
    'observations',
    'lessons',
    'triggers',
    'runs',
    'checkpoints',
    'handoffs',
    'workspaces',
    'parties',
  ];

  for (const subdir of commonDirs) {
    const fullPath = join(vaultPath, subdir);
    if (existsSync(fullPath)) {
      dirs.push(fullPath);
    }
  }

  // Also scan any directory that exists at root level
  try {
    const entries = readdirSync(vaultPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_')) {
        const fullPath = join(vaultPath, entry.name);
        if (!dirs.includes(fullPath)) {
          dirs.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return dirs;
}

function scanDirectory(
  dir: string,
  vaultPath: string,
  files: VaultFile[],
  cutoff: number,
  primitiveTypes?: string[]
): void {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories (max 2 levels deep)
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

        // Determine primitive type
        const primitiveType = detectPrimitiveType(parsed.frontmatter, fullPath);

        // Filter by primitive type if specified
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
        // Skip files we can't read
      }
    }
  }
}

function detectPrimitiveType(frontmatter: Record<string, unknown>, filePath: string): string {
  // Check explicit type/primitive field
  if (frontmatter.primitive) return String(frontmatter.primitive);
  if (frontmatter.type) return String(frontmatter.type);

  // Infer from path
  const pathLower = filePath.toLowerCase();
  if (pathLower.includes('/tasks/')) return 'task';
  if (pathLower.includes('/projects/')) return 'project';
  if (pathLower.includes('/decisions/')) return 'decision';
  if (pathLower.includes('/people/') || pathLower.includes('/persons/')) return 'person';
  if (pathLower.includes('/daily/') || pathLower.includes('/journal/')) return 'daily-note';
  if (pathLower.includes('/lessons/')) return 'lesson';
  if (pathLower.includes('/triggers/')) return 'trigger';
  if (pathLower.includes('/runs/')) return 'run';
  if (pathLower.includes('/checkpoints/')) return 'checkpoint';
  if (pathLower.includes('/handoffs/')) return 'handoff';
  if (pathLower.includes('/ledger/')) return 'memory_event';
  if (pathLower.includes('/memory/') || pathLower.includes('/memories/')) return 'memory_event';

  return 'unknown';
}

// ============================================================================
// Session Recap Builder
// ============================================================================

export function buildSessionRecap(
  vaultPath: string,
  options: {
    maxAge?: number;
    limit?: number;
    includeContent?: boolean;
  } = {}
): SessionRecap {
  const maxAge = options.maxAge ?? 24 * 60 * 60 * 1000; // 24 hours default
  const limit = options.limit ?? 20;
  const includeContent = options.includeContent ?? false;

  const files = scanVaultFiles(vaultPath, { maxAge, limit });

  if (files.length === 0) {
    return {
      xml: '',
      fileCount: 0,
      primitiveGroups: {},
      timeRange: null,
    };
  }

  // Group by primitive type
  const groups: Record<string, VaultFile[]> = {};
  for (const file of files) {
    const type = file.primitiveType;
    if (!groups[type]) groups[type] = [];
    groups[type].push(file);
  }

  // Build XML
  const lines: string[] = ['<session-recap>'];
  lines.push(`<summary>Found ${files.length} recent items across ${Object.keys(groups).length} categories</summary>`);

  for (const [primitiveType, groupFiles] of Object.entries(groups)) {
    lines.push(`<${primitiveType}-items count="${groupFiles.length}">`);

    for (const file of groupFiles.slice(0, 5)) {
      const title = file.frontmatter.title || file.frontmatter.summary || file.relativePath;
      const status = file.frontmatter.status || '';
      const modified = file.modifiedAt.toISOString().slice(0, 16).replace('T', ' ');

      lines.push(`  <item path="${file.relativePath}" modified="${modified}"${status ? ` status="${status}"` : ''}>`);
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

  // Calculate time range
  const sortedByTime = [...files].sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime());
  const timeRange = {
    oldest: sortedByTime[0].modifiedAt,
    newest: sortedByTime[sortedByTime.length - 1].modifiedAt,
  };

  // Count by primitive type
  const primitiveGroups: Record<string, number> = {};
  for (const [type, groupFiles] of Object.entries(groups)) {
    primitiveGroups[type] = groupFiles.length;
  }

  return {
    xml: lines.join('\n'),
    fileCount: files.length,
    primitiveGroups,
    timeRange,
  };
}

// ============================================================================
// Preference Context Builder
// ============================================================================

export function buildPreferenceContext(
  vaultPath: string,
  options: {
    maxAge?: number;
    limit?: number;
  } = {}
): PreferenceContext {
  const maxAge = options.maxAge ?? 30 * 24 * 60 * 60 * 1000; // 30 days default
  const limit = options.limit ?? 50;

  // Scan for files with preference-related content
  const files = scanVaultFiles(vaultPath, { maxAge, limit: limit * 2 });

  // Filter to preference-related files
  const preferenceFiles = files.filter(file => {
    // Check frontmatter for preference type
    if (file.frontmatter.type === 'preference') return true;
    if (file.primitiveType === 'memory_event' && file.frontmatter.type === 'preference') return true;

    // Check content for preference patterns
    const content = (file.content || '').toLowerCase();
    if (/\b(prefer|like|love|hate|dislike|want|need|always|never)\b/.test(content)) {
      return true;
    }

    return false;
  }).slice(0, limit);

  if (preferenceFiles.length === 0) {
    return {
      xml: '',
      preferenceCount: 0,
      categories: [],
    };
  }

  // Extract categories
  const categories = new Set<string>();
  for (const file of preferenceFiles) {
    if (file.frontmatter.category) {
      categories.add(String(file.frontmatter.category));
    }
  }

  // Build XML
  const lines: string[] = ['<user-preferences>'];

  for (const file of preferenceFiles) {
    const summary = file.frontmatter.summary || file.frontmatter.title || extractPreferenceSummary(file.content);
    if (!summary) continue;

    const category = file.frontmatter.category || 'general';
    const sentiment = file.frontmatter.sentiment || inferSentiment(file.content);

    lines.push(`  <preference category="${escapeXml(String(category))}" sentiment="${sentiment}">`);
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

  // Try to extract the first meaningful sentence
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

// ============================================================================
// Memory Context Formatter
// ============================================================================

export function formatMemoriesForContext(results: any[], collection: string): string {
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

export function formatSearchResults(results: any[], collection: string): string {
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

// ============================================================================
// Utility
// ============================================================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================================
// Combined Context Builder
// ============================================================================

export function buildFullContext(
  vaultPath: string,
  options: {
    includeRecap?: boolean;
    includePreferences?: boolean;
    recapMaxAge?: number;
    preferenceMaxAge?: number;
  } = {}
): string {
  const parts: string[] = [];

  if (options.includeRecap !== false) {
    const recap = buildSessionRecap(vaultPath, {
      maxAge: options.recapMaxAge ?? 24 * 60 * 60 * 1000,
      limit: 15,
      includeContent: true,
    });
    if (recap.xml) {
      parts.push(recap.xml);
    }
  }

  if (options.includePreferences !== false) {
    const prefs = buildPreferenceContext(vaultPath, {
      maxAge: options.preferenceMaxAge ?? 30 * 24 * 60 * 60 * 1000,
      limit: 20,
    });
    if (prefs.xml) {
      parts.push(prefs.xml);
    }
  }

  return parts.join('\n\n');
}
