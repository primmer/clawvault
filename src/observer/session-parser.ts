import * as fs from 'fs';
import * as path from 'path';

type SessionFormat = 'plain' | 'jsonl' | 'markdown';

const JSONL_SAMPLE_LIMIT = 20;
const MARKDOWN_SIGNAL_RE = /^(#{1,6}\s|[-*+]\s|>\s)/;
const MARKDOWN_INLINE_RE = /(\[[^\]]+\]\([^)]+\)|[*_`~])/;
const SESSION_RECAP_BLOCK_RE = /<session-recap\b[^>]*>[\s\S]*?<\/session-recap>/gi;
const TOOL_RESULT_PREVIEW_LIMIT = 150;
const TOOL_RESULT_TYPES = new Set(['tool_result', 'tool-result', 'tool_result_chunk']);

interface ParsedSessionMessage {
  role: string;
  content: unknown;
  type: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeText(value);
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const part of value) {
      const extracted = extractText(part);
      if (extracted) {
        parts.push(extracted);
      }
    }
    return normalizeText(parts.join(' '));
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') {
    return normalizeText(record.text);
  }
  if (typeof record.content === 'string') {
    return normalizeText(record.content);
  }

  return '';
}

function stripSessionRecapBlocks(value: string): string {
  if (!value.includes('<session-recap')) {
    return value;
  }
  return value.replace(SESSION_RECAP_BLOCK_RE, ' ');
}

function truncateToolResult(value: string): string {
  if (value.length <= TOOL_RESULT_PREVIEW_LIMIT) {
    return value;
  }
  return `${value.slice(0, TOOL_RESULT_PREVIEW_LIMIT)} [truncated]`;
}

function isLikelyMetadataContent(content: string, rawContent: unknown): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return true;
  }

  if (/^(?:\{[\s\S]*\}|\[[\s\S]*\])$/.test(trimmed)) {
    return true;
  }

  if (/^(?:metadata|session metadata|tool metadata)\b/i.test(trimmed)) {
    return true;
  }

  if (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent)) {
    const record = rawContent as Record<string, unknown>;
    const hasNarrativeFields = ['text', 'content', 'parts', 'message'].some((key) => key in record);
    if (!hasNarrativeFields) {
      return true;
    }
  }

  return false;
}

function normalizeRole(role: unknown): string {
  if (typeof role !== 'string') {
    return '';
  }
  const normalized = role.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return normalized;
}

function isLikelyJsonMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if ('role' in record || 'content' in record || 'type' in record) {
    return true;
  }

  if ('message' in record && record.message && typeof record.message === 'object') {
    return true;
  }

  return false;
}

function parseMessageEntry(entry: Record<string, unknown>): ParsedSessionMessage | null {
  const entryType = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';

  if ('role' in entry && 'content' in entry) {
    return {
      role: normalizeRole(entry.role),
      content: entry.content,
      type: entryType
    };
  }

  if (entryType === 'message' && entry.message && typeof entry.message === 'object') {
    const message = entry.message as Record<string, unknown>;
    const messageType = typeof message.type === 'string'
      ? message.type.trim().toLowerCase()
      : entryType;
    return {
      role: normalizeRole(message.role),
      content: message.content,
      type: messageType
    };
  }

  if (TOOL_RESULT_TYPES.has(entryType) && 'content' in entry) {
    return {
      role: normalizeRole(entry.role) || 'tool',
      content: entry.content,
      type: entryType
    };
  }

  return null;
}

export function parseSessionJsonLine(line: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return '';
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return '';
  }

  const entry = parsed as Record<string, unknown>;
  const message = parseMessageEntry(entry);
  if (!message) {
    return '';
  }

  if (message.role === 'system' || message.type === 'system') {
    return '';
  }

  const extracted = extractText(message.content);
  const withoutRecap = stripSessionRecapBlocks(extracted);
  const content = normalizeText(withoutRecap);
  if (!content || isLikelyMetadataContent(content, message.content)) {
    return '';
  }

  const isToolResult = TOOL_RESULT_TYPES.has(message.type) || message.role === 'tool';
  const normalizedContent = isToolResult ? truncateToolResult(content) : content;
  if (!normalizedContent) {
    return '';
  }

  return message.role ? `${message.role}: ${normalizedContent}` : normalizedContent;
}

function parseJsonLines(raw: string): string[] {
  const messages: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseSessionJsonLine(trimmed);
    if (parsed) {
      messages.push(parsed);
    }
  }
  return messages;
}

function stripMarkdownSyntax(text: string): string {
  return normalizeText(
    text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .replace(/<[^>]+>/g, '')
  );
}

function normalizeMarkdownLine(line: string): string {
  return stripMarkdownSyntax(
    line
      .replace(/^>\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^#{1,6}\s+/, '')
  );
}

function parseMarkdown(raw: string): string[] {
  const withoutCodeBlocks = raw.replace(/```[\s\S]*?```/g, ' ');
  const blocks = withoutCodeBlocks
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const messages: string[] = [];
  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => normalizeMarkdownLine(line))
      .filter(Boolean);

    if (lines.length === 0) {
      continue;
    }

    const joined = stripMarkdownSyntax(lines.join(' '));
    if (!joined) continue;

    const roleMatch = /^(user|assistant|system|tool)\s*:?\s*(.+)$/i.exec(joined);
    if (roleMatch) {
      const role = normalizeRole(roleMatch[1]);
      const content = normalizeText(roleMatch[2]);
      if (content) {
        messages.push(`${role}: ${content}`);
      }
      continue;
    }

    messages.push(joined);
  }

  return messages;
}

function parsePlainText(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function detectSessionFormat(raw: string, filePath: string): SessionFormat {
  const nonEmptyLines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (nonEmptyLines.length === 0) {
    return 'plain';
  }

  const sample = nonEmptyLines.slice(0, JSONL_SAMPLE_LIMIT);
  const jsonHits = sample.filter((line) => {
    try {
      const parsed = JSON.parse(line) as unknown;
      return isLikelyJsonMessage(parsed);
    } catch {
      return false;
    }
  }).length;

  if (jsonHits >= Math.max(1, Math.ceil(sample.length * 0.6))) {
    return 'jsonl';
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') {
    return 'markdown';
  }

  const markdownSignals = sample.filter((line) => MARKDOWN_SIGNAL_RE.test(line) || MARKDOWN_INLINE_RE.test(line)).length;
  if (markdownSignals >= Math.max(2, Math.ceil(sample.length * 0.4))) {
    return 'markdown';
  }

  return 'plain';
}

export function parseSessionFile(filePath: string): string[] {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf-8');
  const format = detectSessionFormat(raw, resolved);

  if (format === 'jsonl') {
    const parsed = parseJsonLines(raw);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  if (format === 'markdown') {
    const parsed = parseMarkdown(raw);
    if (parsed.length > 0) {
      return parsed;
    }
  }

  return parsePlainText(raw);
}
