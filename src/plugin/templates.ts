/**
 * ClawVault Plugin v2 — Template engine
 *
 * Manages typed primitive schemas (memory_event, person, decision, task, etc.)
 * with keyword-based classification, frontmatter generation, and validation.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type {
  TemplateSchema, TemplateRegistry, ClassificationResult,
  FrontmatterOptions, ValidationResult, FieldDef,
} from './types.js';

// ─── Default Schemas ────────────────────────────────────────────────────────

const DEFAULT_SCHEMAS: TemplateSchema[] = [
  {
    primitive: 'memory_event',
    description: 'General memory event for observations',
    fields: {
      type:        { type: 'string',   required: true, default: 'memory_event' },
      status:      { type: 'string',   required: true, default: 'recorded', enum: ['recorded', 'superseded', 'corrected'] },
      created:     { type: 'datetime', required: true, default: '{{datetime}}' },
      observed_at: { type: 'datetime', required: true },
      source:      { type: 'string',   required: true, enum: ['openclaw', 'claude-code', 'replay', 'manual-correction'] },
      summary:     { type: 'string',   required: true },
      confidence:  { type: 'number' },
      importance:  { type: 'number' },
    },
    keywords: ['preference', 'like', 'hate', 'want', 'need', 'always', 'never', 'remember', 'note'],
  },
  {
    primitive: 'person',
    description: 'People and relationship notes',
    fields: {
      title:        { type: 'string', required: true, default: '{{title}}' },
      date:         { type: 'date',   required: true, default: '{{date}}' },
      type:         { type: 'string', required: true, default: 'person' },
      relationship: { type: 'string', default: 'contact' },
    },
    keywords: ['person', 'contact', 'colleague', 'friend', 'works at', 'lives in', 'email', 'phone', 'name is'],
  },
  {
    primitive: 'decision',
    description: 'Decision records',
    fields: {
      title:  { type: 'string', required: true, default: '{{title}}' },
      date:   { type: 'date',   required: true, default: '{{date}}' },
      type:   { type: 'string', required: true, default: 'decision' },
      status: { type: 'string', default: 'decided', enum: ['proposed', 'decided', 'superseded'] },
    },
    keywords: ['decided', 'decision', 'chose', 'will use', 'go with', 'ship', 'approved', 'rejected'],
  },
  {
    primitive: 'task',
    description: 'Task primitives',
    fields: {
      status:   { type: 'string',   required: true, default: 'open', enum: ['open', 'in-progress', 'blocked', 'done'] },
      created:  { type: 'datetime', required: true, default: '{{datetime}}' },
      updated:  { type: 'datetime', required: true, default: '{{datetime}}' },
      priority: { type: 'string',   enum: ['critical', 'high', 'medium', 'low'] },
      due:      { type: 'date' },
    },
    keywords: ['task', 'todo', 'need to', 'should', 'must', 'deadline', 'due', 'by tomorrow', 'by tonight'],
  },
  {
    primitive: 'project',
    description: 'Project definition documents',
    fields: {
      type:    { type: 'string',   required: true, default: 'project' },
      status:  { type: 'string',   required: true, default: 'active', enum: ['active', 'paused', 'completed', 'archived'] },
      created: { type: 'datetime', required: true, default: '{{datetime}}' },
      updated: { type: 'datetime', required: true, default: '{{datetime}}' },
    },
    keywords: ['project', 'initiative', 'working on', 'building', 'developing'],
  },
  {
    primitive: 'lesson',
    description: 'Lessons learned',
    fields: {
      title: { type: 'string', required: true, default: '{{title}}' },
      date:  { type: 'date',   required: true, default: '{{date}}' },
      type:  { type: 'string', required: true, default: 'lesson' },
    },
    keywords: ['learned', 'lesson', 'insight', 'realized', 'discovered', 'found out'],
  },
];

// ─── YAML Parsing (self-contained, no deps) ────────────────────────────────

export function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
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
  let currentKey = '';
  let nestedObject: Record<string, unknown> | null = null;
  let nestedKey = '';

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      if (nestedObject && nestedKey) {
        const arr = nestedObject[nestedKey];
        if (Array.isArray(arr)) arr.push(parseYamlValue(value));
      } else if (currentKey && result[currentKey]) {
        const arr = result[currentKey];
        if (Array.isArray(arr)) (arr as unknown[]).push(parseYamlValue(value));
      }
      continue;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const valueStr = trimmed.slice(colonIndex + 1).trim();

    if (indent === 0) {
      if (valueStr === '' || valueStr === '|' || valueStr === '>') {
        if (key === 'fields') {
          result[key] = {};
          nestedObject = result[key] as Record<string, unknown>;
          nestedKey = '';
        } else {
          result[key] = {};
          nestedObject = null;
        }
      } else {
        result[key] = parseYamlValue(valueStr);
        nestedObject = null;
      }
      currentKey = key;
    } else if (nestedObject && indent > 0) {
      if (valueStr === '' || valueStr === '|' || valueStr === '>') {
        nestedObject[key] = {};
        nestedKey = key;
      } else if (nestedKey && indent > 2) {
        const fieldObj = nestedObject[nestedKey] as Record<string, unknown> | undefined;
        if (fieldObj) {
          if (key === 'enum') {
            fieldObj[key] = [];
          } else {
            fieldObj[key] = parseYamlValue(valueStr);
          }
        }
      } else {
        nestedObject[key] = parseYamlValue(valueStr);
        nestedKey = key;
      }
    }
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

// ─── Template Registry ──────────────────────────────────────────────────────

let registry: TemplateRegistry | null = null;

export function getTemplateRegistry(): TemplateRegistry {
  if (!registry) {
    registry = {
      schemas: new Map(),
      keywordIndex: new Map(),
      initialized: false,
    };
  }
  return registry;
}

export function initializeTemplateRegistry(templatesDir?: string): TemplateRegistry {
  const reg = getTemplateRegistry();
  if (reg.initialized) return reg;

  const dirsToTry = templatesDir ? [templatesDir] : [
    join(process.cwd(), 'templates'),
    join(process.cwd(), '..', '..', 'templates'),
    join(process.env.HOME ?? '.', 'clawvault', 'templates'),
    join(process.env.HOME ?? '.', '.clawvault', 'templates'),
  ];

  let loaded = false;
  for (const dir of dirsToTry) {
    if (existsSync(dir)) {
      try {
        loadTemplatesFromDirectory(dir, reg);
        loaded = true;
        break;
      } catch {
        // try next
      }
    }
  }

  if (!loaded || reg.schemas.size === 0) {
    loadDefaultSchemas(reg);
  }

  buildKeywordIndex(reg);
  reg.initialized = true;
  return reg;
}

function loadTemplatesFromDirectory(dir: string, reg: TemplateRegistry): void {
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = join(dir, file);
    const content = readFileSync(filePath, 'utf-8');
    const parsed = parseYamlFrontmatter(content);
    if (!parsed?.frontmatter?.primitive) continue;
    const schema = convertFrontmatterToSchema(
      parsed.frontmatter as Record<string, unknown>,
      parsed.body,
    );
    if (schema) {
      reg.schemas.set(schema.primitive, schema);
    }
  }
}

function convertFrontmatterToSchema(fm: Record<string, unknown>, body: string): TemplateSchema | null {
  const primitive = fm.primitive as string | undefined;
  if (!primitive) return null;

  const fields: Record<string, FieldDef> = {};
  const fmFields = fm.fields as Record<string, Record<string, unknown>> | undefined;
  if (fmFields) {
    for (const [fieldName, fieldDef] of Object.entries(fmFields)) {
      if (typeof fieldDef === 'object' && fieldDef !== null) {
        fields[fieldName] = {
          type: (fieldDef.type as FieldDef['type']) || 'string',
          required: fieldDef.required as boolean | undefined,
          default: fieldDef.default as string | number | boolean | undefined,
          enum: fieldDef.enum as string[] | undefined,
          description: fieldDef.description as string | undefined,
        };
      }
    }
  }

  const keywords = extractKeywordsFromSchema(primitive, fm.description as string | undefined, fields);

  return {
    primitive,
    description: fm.description as string | undefined,
    fields,
    bodyTemplate: body,
    keywords,
  };
}

function extractKeywordsFromSchema(
  primitive: string,
  _description: string | undefined,
  fields: Record<string, FieldDef>,
): string[] {
  const keywords = [primitive];
  keywords.push(primitive.replace(/-/g, ' '));
  keywords.push(primitive.replace(/_/g, ' '));

  const keywordMap: Record<string, string[]> = {
    memory_event: ['preference', 'like', 'hate', 'want', 'need', 'always', 'never', 'remember', 'note'],
    person: ['person', 'contact', 'colleague', 'friend', 'works at', 'lives in', 'email', 'phone', 'name is'],
    decision: ['decided', 'decision', 'chose', 'will use', 'go with', 'ship', 'approved', 'rejected'],
    task: ['task', 'todo', 'need to', 'should', 'must', 'deadline', 'due', 'by tomorrow', 'by tonight'],
    project: ['project', 'initiative', 'working on', 'building', 'developing'],
    lesson: ['learned', 'lesson', 'insight', 'realized', 'discovered', 'found out'],
    trigger: ['trigger', 'schedule', 'cron', 'automated', 'recurring'],
    run: ['run', 'execution', 'job', 'started', 'finished', 'failed'],
    checkpoint: ['checkpoint', 'snapshot', 'state', 'progress'],
    handoff: ['handoff', 'transition', 'context', 'resume'],
    'daily-note': ['daily', 'today', 'journal', 'log'],
    daily: ['daily', 'today', 'journal', 'log'],
    party: ['party', 'agent', 'human', 'runtime', 'service'],
    workspace: ['workspace', 'shared', 'collaboration'],
  };

  if (keywordMap[primitive]) {
    keywords.push(...keywordMap[primitive]);
  }

  if (fields.status?.enum) {
    keywords.push(...fields.status.enum);
  }

  return [...new Set(keywords)];
}

function loadDefaultSchemas(reg: TemplateRegistry): void {
  for (const schema of DEFAULT_SCHEMAS) {
    reg.schemas.set(schema.primitive, schema);
  }
}

function buildKeywordIndex(reg: TemplateRegistry): void {
  reg.keywordIndex.clear();
  for (const [primitive, schema] of reg.schemas) {
    const keywords = schema.keywords ?? [primitive];
    for (const keyword of keywords) {
      const lower = keyword.toLowerCase();
      const existing = reg.keywordIndex.get(lower) ?? [];
      if (!existing.includes(primitive)) {
        existing.push(primitive);
      }
      reg.keywordIndex.set(lower, existing);
    }
  }
}

// ─── Classification ─────────────────────────────────────────────────────────

export function classifyText(text: string): ClassificationResult {
  const reg = getTemplateRegistry();
  if (!reg.initialized) initializeTemplateRegistry();

  const lower = text.toLowerCase();
  const scores = new Map<string, { score: number; keywords: string[] }>();

  for (const [keyword, primitives] of reg.keywordIndex) {
    if (lower.includes(keyword)) {
      for (const primitive of primitives) {
        const existing = scores.get(primitive) ?? { score: 0, keywords: [] };
        existing.score += getKeywordWeight(keyword, primitive);
        existing.keywords.push(keyword);
        scores.set(primitive, existing);
      }
    }
  }

  applyPatternScoring(lower, scores);

  let bestPrimitive = 'memory_event';
  let bestScore = 0;
  let bestKeywords: string[] = [];

  for (const [primitive, data] of scores) {
    if (data.score > bestScore) {
      bestScore = data.score;
      bestPrimitive = primitive;
      bestKeywords = data.keywords;
    }
  }

  const confidence = Math.min(1, bestScore / 5);

  return {
    primitiveType: bestPrimitive,
    confidence,
    matchedKeywords: [...new Set(bestKeywords)],
  };
}

function getKeywordWeight(keyword: string, primitive: string): number {
  if (keyword === primitive || keyword === primitive.replace(/-/g, ' ')) return 3;

  const strongIndicators: Record<string, string[]> = {
    person: ['works at', 'lives in', 'email', 'phone', 'name is'],
    decision: ['decided', 'chose', 'will use', 'go with'],
    task: ['deadline', 'due', 'by tomorrow', 'by tonight'],
    memory_event: ['preference', 'remember', 'note'],
  };

  if (strongIndicators[primitive]?.includes(keyword)) return 2;
  return 1;
}

function applyPatternScoring(text: string, scores: Map<string, { score: number; keywords: string[] }>): void {
  const patterns: Array<{ regex: RegExp; primitive: string; weight: number; label: string }> = [
    { regex: /\b(my .+ is|his .+ is|her .+ is|their .+ is)\b/i, primitive: 'person', weight: 2, label: 'possessive pattern' },
    { regex: /[\w.-]+@[\w.-]+\.\w+|\+\d{10,}/, primitive: 'person', weight: 3, label: 'contact info' },
    { regex: /\b(i prefer|i like|i hate|i love|i want|i need|i always|i never|don't like|dont like)\b/i, primitive: 'memory_event', weight: 3, label: 'preference pattern' },
    { regex: /\b(we decided|let's go with|we're going|i chose|we'll use|ship it|do it)\b/i, primitive: 'decision', weight: 3, label: 'decision pattern' },
    { regex: /\b(by tonight|by tomorrow|deadline|due date|by end of|ship by|ready by)\b/i, primitive: 'task', weight: 2, label: 'deadline pattern' },
  ];

  for (const { regex, primitive, weight, label } of patterns) {
    if (regex.test(text)) {
      const existing = scores.get(primitive) ?? { score: 0, keywords: [] };
      existing.score += weight;
      existing.keywords.push(label);
      scores.set(primitive, existing);
    }
  }
}

// ─── Schema Access ──────────────────────────────────────────────────────────

export function getSchema(primitiveType: string): TemplateSchema | undefined {
  const reg = getTemplateRegistry();
  if (!reg.initialized) initializeTemplateRegistry();
  return reg.schemas.get(primitiveType);
}

export function getAllSchemas(): TemplateSchema[] {
  const reg = getTemplateRegistry();
  if (!reg.initialized) initializeTemplateRegistry();
  return Array.from(reg.schemas.values());
}

export function getSchemaNames(): string[] {
  const reg = getTemplateRegistry();
  if (!reg.initialized) initializeTemplateRegistry();
  return Array.from(reg.schemas.keys());
}

// ─── Frontmatter Generation & Validation ────────────────────────────────────

export function generateFrontmatter(
  primitiveType: string,
  options: FrontmatterOptions = {},
): Record<string, unknown> {
  const schema = getSchema(primitiveType);
  if (!schema) {
    return {
      type: primitiveType,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
  }

  const frontmatter: Record<string, unknown> = {};
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const datetimeStr = now.toISOString();

  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if (options.extraFields?.[fieldName] !== undefined) {
      const value = options.extraFields[fieldName];
      if (fieldDef.enum && !fieldDef.enum.includes(String(value))) {
        frontmatter[fieldName] = fieldDef.default ?? fieldDef.enum[0];
      } else {
        frontmatter[fieldName] = value;
      }
      continue;
    }

    if (fieldDef.default !== undefined) {
      let defaultValue: unknown = fieldDef.default;
      if (typeof defaultValue === 'string') {
        defaultValue = defaultValue
          .replace('{{datetime}}', datetimeStr)
          .replace('{{date}}', dateStr)
          .replace('{{title}}', options.title ?? 'Untitled');
      }
      frontmatter[fieldName] = defaultValue;
    } else if (fieldDef.required) {
      switch (fieldDef.type) {
        case 'datetime': frontmatter[fieldName] = datetimeStr; break;
        case 'date':     frontmatter[fieldName] = dateStr; break;
        case 'string':   frontmatter[fieldName] = fieldDef.enum?.length ? fieldDef.enum[0] : ''; break;
        case 'number':   frontmatter[fieldName] = 0; break;
        case 'boolean':  frontmatter[fieldName] = false; break;
      }
    }
  }

  if (options.source && schema.fields.source) frontmatter.source = options.source;
  if (options.sessionId && schema.fields.session_id) frontmatter.session_id = options.sessionId;

  return frontmatter;
}

export function validateFrontmatter(
  primitiveType: string,
  frontmatter: Record<string, unknown>,
): ValidationResult {
  const schema = getSchema(primitiveType);
  if (!schema) return { valid: true, errors: [] };

  const errors: string[] = [];

  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    const value = frontmatter[fieldName];

    if (fieldDef.required && (value === undefined || value === null || value === '')) {
      errors.push(`Missing required field: ${fieldName}`);
      continue;
    }
    if (value === undefined || value === null) continue;

    if (fieldDef.enum && !fieldDef.enum.includes(String(value))) {
      errors.push(`Invalid value for ${fieldName}: "${String(value)}". Must be one of: ${fieldDef.enum.join(', ')}`);
    }

    switch (fieldDef.type) {
      case 'number':
        if (typeof value !== 'number' && isNaN(Number(value))) {
          errors.push(`Field ${fieldName} must be a number`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors.push(`Field ${fieldName} must be a boolean`);
        }
        break;
      case 'datetime':
        if (typeof value === 'string' && isNaN(Date.parse(value))) {
          errors.push(`Field ${fieldName} must be a valid datetime`);
        }
        break;
      case 'date':
        if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors.push(`Field ${fieldName} must be a valid date (YYYY-MM-DD)`);
        }
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${String(item)}`);
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else if (typeof value === 'string' && value.includes('\n')) {
      lines.push(`${key}: |`);
      for (const line of value.split('\n')) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}
