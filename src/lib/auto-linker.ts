import { EntityIndex, getSortedAliases } from './entity-index.js';

interface ProtectedRange {
  start: number;
  end: number;
}

interface ExistingLinkResolution {
  alias: string;
  path: string;
  line: number;
}

/**
 * Find all protected ranges in the content that should not be linked:
 * - Frontmatter (--- blocks)
 * - Code blocks (``` or ~~~)
 * - Inline code (`)
 * - Existing wiki links ([[...]])
 * - URLs
 */
function findProtectedRanges(
  content: string,
  options: { includeWikiLinks?: boolean } = {}
): ProtectedRange[] {
  const includeWikiLinks = options.includeWikiLinks ?? true;
  const ranges: ProtectedRange[] = [];
  
  // Frontmatter (must be at start)
  const fmMatch = content.match(/^---\n[\s\S]*?\n---/);
  if (fmMatch) {
    ranges.push({ start: 0, end: fmMatch[0].length });
  }
  
  // Code blocks
  const codeBlockRegex = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
  let match;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  
  // Inline code
  const inlineCodeRegex = /`[^`]+`/g;
  while ((match = inlineCodeRegex.exec(content)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  
  if (includeWikiLinks) {
    // Existing wiki links
    const wikiLinkRegex = /\[\[[^\]]+\]\]/g;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  
  // URLs
  const urlRegex = /https?:\/\/[^\s)>\]]+/g;
  while ((match = urlRegex.exec(content)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  
  return ranges;
}

/**
 * Check if a position is within any protected range
 */
function isProtected(pos: number, ranges: ProtectedRange[]): boolean {
  return ranges.some(r => pos >= r.start && pos < r.end);
}

function createLineLookup(content: string): (pos: number) => number {
  const lines = content.split('\n');
  let charPos = 0;
  const lineStarts: number[] = [];
  for (const line of lines) {
    lineStarts.push(charPos);
    charPos += line.length + 1;
  }

  return (pos: number) => {
    for (let i = lineStarts.length - 1; i >= 0; i--) {
      if (pos >= lineStarts[i]) return i + 1;
    }
    return 1;
  };
}

function normalizeWikiTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return '';
  let normalized = trimmed.replace(/\\/g, '/');
  if (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }
  if (normalized.endsWith('.md')) {
    normalized = normalized.slice(0, -3);
  }
  return normalized.trim();
}

function sanitizeMalformedWikiLinks(content: string): string {
  return content
    .replace(/\[\[\[+/g, '[[')
    .replace(/\]\]\]+/g, ']]');
}

function targetAlreadyContainsResolvedPath(target: string, resolvedPath: string): boolean {
  const normalizedTarget = normalizeWikiTarget(target).toLowerCase();
  const normalizedResolved = normalizeWikiTarget(resolvedPath).toLowerCase();
  if (!normalizedTarget || !normalizedResolved) return false;
  if (normalizedTarget === normalizedResolved) return true;
  return normalizedTarget.includes(normalizedResolved);
}

function resolveExistingWikiLinks(
  content: string,
  index: EntityIndex
): { content: string; resolutions: ExistingLinkResolution[] } {
  const linkRegex = /\[\[([^\]]+)\]\]/g;
  const protectedRanges = findProtectedRanges(content, { includeWikiLinks: false });
  const getLineNumber = createLineLookup(content);
  const resolutions: ExistingLinkResolution[] = [];

  const rewritten = content.replace(linkRegex, (fullMatch, inner, offset: number) => {
    if (isProtected(offset, protectedRanges)) {
      return fullMatch;
    }

    const parts = String(inner).split('|');
    const rawTargetPart = parts[0] ?? '';
    const displayPart = parts.length > 1 ? parts.slice(1).join('|').trim() : '';

    const hashIndex = rawTargetPart.indexOf('#');
    const targetPart = hashIndex === -1 ? rawTargetPart : rawTargetPart.slice(0, hashIndex);
    const anchorPart = hashIndex === -1 ? '' : rawTargetPart.slice(hashIndex);

    const normalizedTarget = normalizeWikiTarget(targetPart);
    if (!normalizedTarget) {
      return fullMatch;
    }

    const resolvedPath = index.entries.get(normalizedTarget.toLowerCase());
    if (!resolvedPath) {
      return fullMatch;
    }

    if (targetAlreadyContainsResolvedPath(normalizedTarget, resolvedPath)) {
      return fullMatch;
    }

    const resolvedTargetWithAnchor = `${resolvedPath}${anchorPart}`;
    const defaultLabel = normalizedTarget.toLowerCase() === resolvedPath.split('/').pop()?.toLowerCase()
      ? ''
      : normalizedTarget;
    const displayLabel = displayPart || defaultLabel;

    resolutions.push({
      alias: normalizedTarget,
      path: resolvedPath,
      line: getLineNumber(offset)
    });

    if (displayLabel) {
      return `[[${resolvedTargetWithAnchor}|${displayLabel}]]`;
    }
    return `[[${resolvedTargetWithAnchor}]]`;
  });

  return { content: rewritten, resolutions };
}

/**
 * Auto-link entities in markdown content.
 * Only links first occurrence of each entity.
 * Skips protected ranges (frontmatter, code, existing links, URLs).
 */
export function autoLink(content: string, index: EntityIndex): string {
  const sanitized = sanitizeMalformedWikiLinks(content);
  const { content: resolvedLinksContent, resolutions } = resolveExistingWikiLinks(sanitized, index);
  const protectedRanges = findProtectedRanges(resolvedLinksContent);
  const sortedAliases = getSortedAliases(index);
  const linkedEntities = new Set<string>(resolutions.map((resolution) => resolution.path));
  
  let result = resolvedLinksContent;
  let offset = 0;  // Track position shifts from replacements
  
  for (const { alias, path } of sortedAliases) {
    // Skip if we already linked this entity
    if (linkedEntities.has(path)) continue;
    
    // Create word-boundary regex (case-insensitive)
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedAlias}\\b`, 'gi');
    
    let match;
    while ((match = regex.exec(resolvedLinksContent)) !== null) {
      const originalPos = match.index;
      const adjustedPos = originalPos + offset;
      
      // Check if this position is protected in the ORIGINAL content
      if (isProtected(originalPos, protectedRanges)) continue;
      
      // Check if already inside a link in current result
      const beforeMatch = result.substring(0, adjustedPos);
      const openBrackets = (beforeMatch.match(/\[\[/g) || []).length;
      const closeBrackets = (beforeMatch.match(/\]\]/g) || []).length;
      if (openBrackets > closeBrackets) continue;
      
      // Found a valid match - replace it
      const originalText = match[0];
      const replacement = originalText.toLowerCase() === path.split('/').pop()?.toLowerCase()
        ? `[[${path}]]`
        : `[[${path}|${originalText}]]`;
      
      result = result.substring(0, adjustedPos) + replacement + result.substring(adjustedPos + originalText.length);
      offset += replacement.length - originalText.length;
      
      linkedEntities.add(path);
      break;  // Only link first occurrence
    }
  }
  
  return result;
}

/**
 * Show what would be linked (dry run)
 */
export function dryRunLink(content: string, index: EntityIndex): Array<{ alias: string; path: string; line: number }> {
  const sanitized = sanitizeMalformedWikiLinks(content);
  const { content: resolvedLinksContent, resolutions } = resolveExistingWikiLinks(sanitized, index);
  const protectedRanges = findProtectedRanges(resolvedLinksContent);
  const sortedAliases = getSortedAliases(index);
  const linkedEntities = new Set<string>(resolutions.map((resolution) => resolution.path));
  const matches: Array<{ alias: string; path: string; line: number }> = [...resolutions];
  const getLineNumber = createLineLookup(resolvedLinksContent);
  
  for (const { alias, path } of sortedAliases) {
    if (linkedEntities.has(path)) continue;
    
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedAlias}\\b`, 'gi');
    
    let match;
    while ((match = regex.exec(resolvedLinksContent)) !== null) {
      if (isProtected(match.index, protectedRanges)) continue;
      
      matches.push({
        alias: match[0],
        path,
        line: getLineNumber(match.index)
      });
      linkedEntities.add(path);
      break;
    }
  }
  
  return matches;
}

/**
 * Find unlinked mentions of entities (suggested links).
 */
export function findUnlinkedMentions(
  content: string,
  index: EntityIndex
): Array<{ alias: string; path: string; line: number }> {
  const protectedRanges = findProtectedRanges(content);
  const sortedAliases = getSortedAliases(index);
  const matches: Array<{ alias: string; path: string; line: number }> = [];
  const seen = new Set<string>();
  const getLineNumber = createLineLookup(content);

  for (const { alias, path } of sortedAliases) {
    if (seen.has(path)) continue;

    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedAlias}\\b`, 'gi');

    let match;
    while ((match = regex.exec(content)) !== null) {
      if (isProtected(match.index, protectedRanges)) continue;

      matches.push({
        alias: match[0],
        path,
        line: getLineNumber(match.index)
      });
      seen.add(path);
      break;
    }
  }

  return matches;
}
