/**
 * ClawVault Plugin v2 — Vault file operations
 *
 * Handles writing, updating, and managing vault markdown files:
 * - Template-based file creation
 * - Frontmatter merge on update
 * - Observation writing to individual files and ledger
 * - Scope tagging for multi-scope support
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import {
  classifyText, getSchema, generateFrontmatter, validateFrontmatter,
  serializeFrontmatter, parseYamlFrontmatter,
} from './templates.js';
import type {
  WriteResult, WriteOptions, Observation, LedgerEntry,
  BatchWriteOptions, BatchWriteResult, MemoryScope,
} from './types.js';

// ─── Auto-Embed Hook ───────────────────────────────────────────────────────

/** Hook for auto-embedding new memories. Set by the plugin index. */
let autoEmbedFn: ((filePath: string, content: string) => Promise<void>) | null = null;

export function setAutoEmbedFn(fn: (filePath: string, content: string) => Promise<void>): void {
  autoEmbedFn = fn;
}

async function autoEmbed(filePath: string, content: string): Promise<void> {
  if (autoEmbedFn) {
    await autoEmbedFn(filePath, content).catch(() => { /* best-effort */ });
  }
}

// ─── File Writing ───────────────────────────────────────────────────────────

export function writeVaultFile(vaultPath: string, options: WriteOptions): WriteResult {
  const errors: string[] = [];

  const primitiveType = options.primitiveType ??
    classifyText(options.content ?? options.title ?? '').primitiveType;

  const schema = getSchema(primitiveType);
  const frontmatter = generateFrontmatter(primitiveType, {
    title: options.title,
    extraFields: options.extraFields,
    source: options.source,
    sessionId: options.sessionId,
  });

  const validation = validateFrontmatter(primitiveType, frontmatter);
  if (!validation.valid) errors.push(...validation.errors);

  const directory = options.directory ?? getDefaultDirectory(vaultPath, primitiveType);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  const filename = options.filename ?? generateFilename(primitiveType, options.title, frontmatter);
  const filePath = join(directory, filename);
  const fileExists = existsSync(filePath);

  if (fileExists && !options.overwrite) {
    return updateVaultFile(filePath, frontmatter, options.content, primitiveType, errors);
  }

  const fileContent = buildFileContent(frontmatter, options.content, schema);
  try {
    writeFileSync(filePath, fileContent, 'utf-8');
    autoEmbed(filePath, fileContent).catch(() => { /* best-effort */ });
    return {
      success: errors.length === 0,
      path: filePath,
      primitiveType,
      errors,
      created: true,
      updated: false,
    };
  } catch (err) {
    errors.push(`Failed to write file: ${String(err)}`);
    return {
      success: false,
      path: filePath,
      primitiveType,
      errors,
      created: false,
      updated: false,
    };
  }
}

function updateVaultFile(
  filePath: string,
  newFrontmatter: Record<string, unknown>,
  newContent: string | undefined,
  primitiveType: string,
  errors: string[],
): WriteResult {
  try {
    const existingContent = readFileSync(filePath, 'utf-8');
    const parsed = parseExistingFile(existingContent);
    if (!parsed) {
      errors.push('Failed to parse existing file');
      return { success: false, path: filePath, primitiveType, errors, created: false, updated: false };
    }

    const mergedFrontmatter: Record<string, unknown> = {
      ...parsed.frontmatter,
      ...newFrontmatter,
      updated: new Date().toISOString(),
    };
    if (parsed.frontmatter.created) {
      mergedFrontmatter.created = parsed.frontmatter.created;
    }

    const content = newContent ?? parsed.body;
    const schema = getSchema(primitiveType);
    const fileContent = buildFileContent(mergedFrontmatter, content, schema);
    writeFileSync(filePath, fileContent, 'utf-8');

    return {
      success: errors.length === 0,
      path: filePath,
      primitiveType,
      errors,
      created: false,
      updated: true,
    };
  } catch (err) {
    errors.push(`Failed to update file: ${String(err)}`);
    return { success: false, path: filePath, primitiveType, errors, created: false, updated: false };
  }
}

function parseExistingFile(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  try {
    const result: Record<string, unknown> = {};
    for (const line of match[1].split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      const key = line.slice(0, colonIndex).trim();
      const valueStr = line.slice(colonIndex + 1).trim();
      if (valueStr === '' || valueStr.startsWith('|') || valueStr.startsWith('>')) continue;
      result[key] = parseSimpleValue(valueStr);
    }
    return { frontmatter: result, body: match[2] };
  } catch {
    return null;
  }
}

function parseSimpleValue(value: string): unknown {
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

// ─── Directory / Filename Helpers ───────────────────────────────────────────

function getDefaultDirectory(vaultPath: string, primitiveType: string): string {
  const directoryMap: Record<string, string> = {
    task: 'tasks',
    project: 'projects',
    decision: 'decisions',
    person: 'people',
    lesson: 'lessons',
    trigger: 'triggers',
    run: 'runs',
    checkpoint: 'checkpoints',
    handoff: 'handoffs',
    'daily-note': 'daily',
    daily: 'daily',
    party: 'parties',
    workspace: 'workspaces',
    memory_event: 'memory',
  };

  const subdir = directoryMap[primitiveType] ?? 'notes';
  return join(vaultPath, subdir);
}

function generateFilename(
  primitiveType: string,
  title: string | undefined,
  _frontmatter: Record<string, unknown>,
): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');

  if (title) {
    const slug = slugify(title);
    return `${dateStr}-${slug}.md`;
  }

  switch (primitiveType) {
    case 'daily-note':
    case 'daily':
      return `${dateStr}.md`;
    case 'memory_event':
      return `${dateStr}-${timeStr}.md`;
    case 'run':
      return `run-${dateStr}-${timeStr}.md`;
    case 'checkpoint':
      return `checkpoint-${dateStr}-${timeStr}.md`;
    case 'handoff':
      return `handoff-${dateStr}-${timeStr}.md`;
    default:
      return `${primitiveType}-${dateStr}-${timeStr}.md`;
  }
}

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function buildFileContent(
  frontmatter: Record<string, unknown>,
  content: string | undefined,
  schema?: { bodyTemplate?: string },
): string {
  const parts: string[] = [];
  parts.push(serializeFrontmatter(frontmatter));
  parts.push('');

  const title = frontmatter.title || frontmatter.summary;
  if (title) {
    parts.push(`# ${String(title)}`);
    parts.push('');
  }

  if (content) {
    parts.push(content);
  } else if (schema?.bodyTemplate) {
    let body = schema.bodyTemplate;
    body = body.replace(/\{\{title\}\}/g, String(title || 'Untitled'));
    body = body.replace(/\{\{date\}\}/g, new Date().toISOString().split('T')[0]);
    body = body.replace(/\{\{datetime\}\}/g, new Date().toISOString());
    body = body.replace(/\{\{links_line\}\}/g, '');
    body = body.replace(/\{\{content\}\}/g, '');
    parts.push(body.trim());
  }

  return parts.join('\n');
}

// ─── Observation Writing ────────────────────────────────────────────────────

export function writeObservation(
  vaultPath: string,
  observation: Observation,
  options: { source?: string; sessionId?: string; scope?: MemoryScope } = {},
): WriteResult {
  const extraFields: Record<string, unknown> = {
    type: observation.primitiveType === 'memory_event' ? observation.category : observation.primitiveType,
    confidence: observation.confidence,
    tags: observation.tags,
    observed_at: observation.extractedAt.toISOString(),
  };
  if (options.scope && options.scope !== 'global') {
    extraFields.scope = options.scope;
  }

  return writeVaultFile(vaultPath, {
    primitiveType: observation.primitiveType,
    title: observation.text.slice(0, 80),
    content: observation.text,
    extraFields,
    source: options.source ?? 'openclaw',
    sessionId: options.sessionId,
  });
}

// ─── Ledger Operations ─────────────────────────────────────────────────────

export function appendToLedger(vaultPath: string, entry: LedgerEntry): void {
  const dateStr = entry.timestamp.toISOString().slice(0, 10);
  const ledgerDir = join(vaultPath, 'ledger');
  if (!existsSync(ledgerDir)) {
    mkdirSync(ledgerDir, { recursive: true });
  }

  const ledgerFile = join(ledgerDir, `${dateStr}.md`);
  const timeStr = entry.timestamp.toISOString().slice(11, 19);

  const parts = [`[${timeStr}]`];
  if (entry.category) parts.push(`[${entry.category}]`);
  if (entry.actor) parts.push(`(${entry.actor})`);
  parts.push(entry.content);

  const line = `\n- ${parts.join(' ')}`;

  if (!existsSync(ledgerFile)) {
    const frontmatter = serializeFrontmatter({
      type: 'ledger',
      date: dateStr,
      created: entry.timestamp.toISOString(),
    });
    writeFileSync(ledgerFile, `${frontmatter}\n\n# Observation Ledger \u2014 ${dateStr}\n${line}`, 'utf-8');
  } else {
    appendFileSync(ledgerFile, line, 'utf-8');
  }
}

export function appendObservationToLedger(
  vaultPath: string,
  observation: Observation,
  actor?: string,
): void {
  appendToLedger(vaultPath, {
    timestamp: observation.extractedAt,
    category: observation.category,
    actor,
    content: observation.text,
    primitiveType: observation.primitiveType,
    tags: observation.tags,
  });
}

// ─── Batch Operations ───────────────────────────────────────────────────────

export function batchWriteObservations(
  vaultPath: string,
  observations: Observation[],
  options: BatchWriteOptions = {},
): BatchWriteResult {
  const results: WriteResult[] = [];
  let successful = 0;
  let failed = 0;
  const writeLedger = options.writeLedger ?? true;
  const writeFiles = options.writeFiles ?? false;

  for (const observation of observations) {
    if (writeLedger) {
      try {
        appendObservationToLedger(vaultPath, observation, options.actor);
      } catch {
        // ledger write failure is non-fatal
      }
    }

    if (writeFiles) {
      const result = writeObservation(vaultPath, observation, {
        source: options.source,
        sessionId: options.sessionId,
      });
      results.push(result);
      if (result.success) successful++;
      else failed++;
    } else {
      successful++;
      results.push({
        success: true,
        path: join(vaultPath, 'ledger', `${observation.extractedAt.toISOString().slice(0, 10)}.md`),
        primitiveType: observation.primitiveType,
        errors: [],
        created: false,
        updated: true,
      });
    }
  }

  return { total: observations.length, successful, failed, results };
}

// ─── Vault Structure ────────────────────────────────────────────────────────

export function ensureVaultStructure(vaultPath: string): void {
  const directories = [
    'tasks', 'projects', 'decisions', 'people',
    'lessons', 'memory', 'ledger', 'daily',
  ];
  for (const dir of directories) {
    const fullPath = join(vaultPath, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
}
