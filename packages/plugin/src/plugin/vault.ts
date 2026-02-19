/**
 * Template-Aware Vault File Writing for ClawVault
 *
 * Writes vault files with proper frontmatter based on template schemas.
 * Validates enum fields, applies defaults, and adds timestamps.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import {
  getSchema,
  generateFrontmatter,
  validateFrontmatter,
  serializeFrontmatter,
  classifyText,
  type TemplateSchema,
  type FrontmatterOptions,
} from './templates.js';
import { type Observation } from './observe.js';

// ============================================================================
// Types
// ============================================================================

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

export interface WriteResult {
  success: boolean;
  path: string;
  primitiveType: string;
  errors: string[];
  created: boolean;
  updated: boolean;
}

export interface LedgerEntry {
  timestamp: Date;
  category: string;
  actor?: string;
  content: string;
  primitiveType?: string;
  tags?: string[];
}

// ============================================================================
// File Writing
// ============================================================================

export function writeVaultFile(vaultPath: string, options: WriteOptions): WriteResult {
  const errors: string[] = [];

  // Determine primitive type
  const primitiveType = options.primitiveType ?? classifyText(options.content ?? options.title ?? '').primitiveType;

  // Get schema for validation
  const schema = getSchema(primitiveType);

  // Generate frontmatter
  const frontmatter = generateFrontmatter(primitiveType, {
    title: options.title,
    extraFields: options.extraFields,
    source: options.source,
    sessionId: options.sessionId,
  });

  // Validate frontmatter
  const validation = validateFrontmatter(primitiveType, frontmatter);
  if (!validation.valid) {
    errors.push(...validation.errors);
  }

  // Determine output directory
  const directory = options.directory ?? getDefaultDirectory(vaultPath, primitiveType);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  // Determine filename
  const filename = options.filename ?? generateFilename(primitiveType, options.title, frontmatter);
  const filePath = join(directory, filename);

  // Check if file exists
  const fileExists = existsSync(filePath);
  if (fileExists && !options.overwrite) {
    // Update existing file
    return updateVaultFile(filePath, frontmatter, options.content, primitiveType, errors);
  }

  // Build file content
  const fileContent = buildFileContent(frontmatter, options.content, schema);

  // Write file
  try {
    writeFileSync(filePath, fileContent, 'utf-8');
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
  errors: string[]
): WriteResult {
  try {
    const existingContent = readFileSync(filePath, 'utf-8');
    const parsed = parseExistingFile(existingContent);

    if (!parsed) {
      errors.push('Failed to parse existing file');
      return {
        success: false,
        path: filePath,
        primitiveType,
        errors,
        created: false,
        updated: false,
      };
    }

    // Merge frontmatter (preserve existing, update timestamps)
    const mergedFrontmatter: Record<string, unknown> = {
      ...parsed.frontmatter,
      ...newFrontmatter,
      updated: new Date().toISOString(),
    };

    // Preserve created timestamp
    if (parsed.frontmatter.created) {
      mergedFrontmatter.created = parsed.frontmatter.created;
    }

    // Use new content or preserve existing
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

function parseExistingFile(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
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
  frontmatter: Record<string, unknown>
): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');

  // Use title if provided
  if (title) {
    const slug = slugify(title);
    return `${dateStr}-${slug}.md`;
  }

  // Use primitive-specific naming
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
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function buildFileContent(
  frontmatter: Record<string, unknown>,
  content: string | undefined,
  schema: TemplateSchema | undefined
): string {
  const parts: string[] = [];

  // Add frontmatter
  parts.push(serializeFrontmatter(frontmatter));
  parts.push('');

  // Add title if present
  const title = frontmatter.title || frontmatter.summary;
  if (title) {
    parts.push(`# ${title}`);
    parts.push('');
  }

  // Add content
  if (content) {
    parts.push(content);
  } else if (schema?.bodyTemplate) {
    // Use template body as starting point
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

// ============================================================================
// Observation Writing
// ============================================================================

export function writeObservation(
  vaultPath: string,
  observation: Observation,
  options: { source?: string; sessionId?: string } = {}
): WriteResult {
  return writeVaultFile(vaultPath, {
    primitiveType: observation.primitiveType,
    title: observation.text.slice(0, 80),
    content: observation.text,
    extraFields: {
      type: observation.primitiveType === 'memory_event' ? observation.category : observation.primitiveType,
      confidence: observation.confidence,
      tags: observation.tags,
      observed_at: observation.extractedAt.toISOString(),
    },
    source: options.source ?? 'openclaw',
    sessionId: options.sessionId,
  });
}

export function writeObservations(
  vaultPath: string,
  observations: Observation[],
  options: { source?: string; sessionId?: string } = {}
): WriteResult[] {
  return observations.map(obs => writeObservation(vaultPath, obs, options));
}

// ============================================================================
// Ledger Writing
// ============================================================================

export function appendToLedger(vaultPath: string, entry: LedgerEntry): void {
  const dateStr = entry.timestamp.toISOString().slice(0, 10);
  const ledgerDir = join(vaultPath, 'ledger');

  if (!existsSync(ledgerDir)) {
    mkdirSync(ledgerDir, { recursive: true });
  }

  const ledgerFile = join(ledgerDir, `${dateStr}.md`);
  const timeStr = entry.timestamp.toISOString().slice(11, 19);

  // Build entry line
  const parts = [`[${timeStr}]`];
  if (entry.category) parts.push(`[${entry.category}]`);
  if (entry.actor) parts.push(`(${entry.actor})`);
  parts.push(entry.content);

  const line = `\n- ${parts.join(' ')}`;

  if (!existsSync(ledgerFile)) {
    // Create new ledger file with frontmatter
    const frontmatter = serializeFrontmatter({
      type: 'ledger',
      date: dateStr,
      created: entry.timestamp.toISOString(),
    });
    writeFileSync(ledgerFile, `${frontmatter}\n\n# Observation Ledger — ${dateStr}\n${line}`, 'utf-8');
  } else {
    appendFileSync(ledgerFile, line, 'utf-8');
  }
}

export function appendObservationToLedger(
  vaultPath: string,
  observation: Observation,
  actor?: string
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

// ============================================================================
// Batch Operations
// ============================================================================

export interface BatchWriteResult {
  total: number;
  successful: number;
  failed: number;
  results: WriteResult[];
}

export function batchWriteObservations(
  vaultPath: string,
  observations: Observation[],
  options: {
    source?: string;
    sessionId?: string;
    writeLedger?: boolean;
    writeFiles?: boolean;
    actor?: string;
  } = {}
): BatchWriteResult {
  const results: WriteResult[] = [];
  let successful = 0;
  let failed = 0;

  const writeLedger = options.writeLedger ?? true;
  const writeFiles = options.writeFiles ?? false;

  for (const observation of observations) {
    // Always write to ledger (fast, append-only)
    if (writeLedger) {
      try {
        appendObservationToLedger(vaultPath, observation, options.actor);
      } catch {
        // Ledger write failures are non-fatal
      }
    }

    // Optionally write individual files
    if (writeFiles) {
      const result = writeObservation(vaultPath, observation, {
        source: options.source,
        sessionId: options.sessionId,
      });
      results.push(result);

      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    } else {
      // Count ledger writes as successful
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

  return {
    total: observations.length,
    successful,
    failed,
    results,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

export function ensureVaultStructure(vaultPath: string): void {
  const directories = [
    'tasks',
    'projects',
    'decisions',
    'people',
    'lessons',
    'memory',
    'ledger',
    'daily',
  ];

  for (const dir of directories) {
    const fullPath = join(vaultPath, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
}

export function getVaultStats(vaultPath: string): {
  directories: string[];
  fileCount: number;
  primitiveTypes: Record<string, number>;
} {
  const directories: string[] = [];
  const primitiveTypes: Record<string, number> = {};
  let fileCount = 0;

  const { readdirSync, statSync } = require('node:fs');

  function scanDir(dir: string, depth: number = 0): void {
    if (depth > 2) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          directories.push(fullPath.replace(vaultPath + '/', ''));
          scanDir(fullPath, depth + 1);
        } else if (entry.name.endsWith('.md')) {
          fileCount++;

          // Try to detect primitive type
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const match = content.match(/^---\n[\s\S]*?type:\s*(\S+)/);
            if (match) {
              const type = match[1];
              primitiveTypes[type] = (primitiveTypes[type] ?? 0) + 1;
            }
          } catch {
            // Ignore read errors
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  scanDir(vaultPath);

  return { directories, fileCount, primitiveTypes };
}
