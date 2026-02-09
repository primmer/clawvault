import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import matter from 'gray-matter';

export const WIKI_LINK_REGEX = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;

const MARKDOWN_EXT = '.md';
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.obsidian',
  '.trash',
  'node_modules'
]);

/**
 * Build a graph from markdown notes in a vault.
 * @param {string} vaultPath
 * @param {{ includeDangling?: boolean }} [options]
 */
export async function buildVaultGraph(vaultPath, options = {}) {
  const includeDangling = options.includeDangling !== false;
  const root = path.resolve(vaultPath);
  const markdownFiles = await collectMarkdownFiles(root);

  const nodesById = new Map();
  const edges = [];
  const edgeSet = new Set();

  for (const absoluteFilePath of markdownFiles) {
    const raw = await fs.readFile(absoluteFilePath, 'utf8');
    const parsed = matter(raw);
    const relativePath = path.relative(root, absoluteFilePath);
    const id = toNodeId(relativePath);
    const frontmatter = parsed.data ?? {};

    nodesById.set(id, {
      id,
      title: normalizeString(frontmatter.title) || toDisplayTitle(id),
      category: normalizeString(frontmatter.category) || inferCategory(id),
      tags: normalizeTags(frontmatter.tags),
      path: toPosixPath(relativePath),
      missing: false,
      _outboundTargets: extractWikiLinks(parsed.content)
    });
  }

  const idsByLowercase = new Map();
  const idsByBaseName = new Map();
  for (const id of nodesById.keys()) {
    idsByLowercase.set(id.toLowerCase(), id);
    const baseName = path.posix.basename(id).toLowerCase();
    const existing = idsByBaseName.get(baseName) ?? new Set();
    existing.add(id);
    idsByBaseName.set(baseName, existing);
  }

  for (const node of nodesById.values()) {
    for (const rawTarget of node._outboundTargets) {
      const targetId = resolveTargetId(rawTarget, {
        idsByLowercase,
        idsByBaseName,
        includeDangling
      });

      if (!targetId) {
        continue;
      }

      if (!nodesById.has(targetId) && includeDangling) {
        nodesById.set(targetId, {
          id: targetId,
          title: toDisplayTitle(targetId),
          category: 'unresolved',
          tags: [],
          path: null,
          missing: true,
          _outboundTargets: []
        });
      }

      const edgeKey = `${node.id}=>${targetId}`;
      if (edgeSet.has(edgeKey)) {
        continue;
      }
      edgeSet.add(edgeKey);
      edges.push({ source: node.id, target: targetId });
    }
  }

  const degreeByNodeId = new Map();
  for (const edge of edges) {
    degreeByNodeId.set(edge.source, (degreeByNodeId.get(edge.source) ?? 0) + 1);
    degreeByNodeId.set(edge.target, (degreeByNodeId.get(edge.target) ?? 0) + 1);
  }

  const nodes = Array.from(nodesById.values())
    .map(({ _outboundTargets, ...node }) => ({
      ...node,
      degree: degreeByNodeId.get(node.id) ?? 0
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  edges.sort((a, b) => {
    const sourceSort = a.source.localeCompare(b.source);
    return sourceSort !== 0 ? sourceSort : a.target.localeCompare(b.target);
  });

  return {
    nodes,
    edges,
    stats: {
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      fileCount: markdownFiles.length
    }
  };
}

async function collectMarkdownFiles(root) {
  const pending = [root];
  const files = [];

  while (pending.length > 0) {
    const currentDir = pending.pop();
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(absolutePath);
        }
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(MARKDOWN_EXT)) {
        files.push(absolutePath);
      }
    }
  }

  return files;
}

function extractWikiLinks(markdown) {
  const links = [];
  const regex = new RegExp(WIKI_LINK_REGEX.source, 'g');
  let match = regex.exec(markdown);

  while (match) {
    const rawTarget = match[1]?.trim();
    if (rawTarget) {
      links.push(rawTarget);
    }
    match = regex.exec(markdown);
  }

  return links;
}

function resolveTargetId(target, context) {
  const normalized = normalizeWikiTarget(target);
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();
  const exact = context.idsByLowercase.get(lower);
  if (exact) {
    return exact;
  }

  if (!normalized.includes('/')) {
    const maybeMatches = context.idsByBaseName.get(lower);
    if (maybeMatches?.size === 1) {
      return Array.from(maybeMatches)[0];
    }
  }

  return context.includeDangling ? normalized : null;
}

function normalizeWikiTarget(target) {
  let value = normalizeString(target);
  if (!value) {
    return null;
  }

  const hashIndex = value.indexOf('#');
  if (hashIndex >= 0) {
    value = value.slice(0, hashIndex);
  }

  const caretIndex = value.indexOf('^');
  if (caretIndex >= 0) {
    value = value.slice(0, caretIndex);
  }

  value = value.replace(/\\/g, '/');
  value = value.replace(/^\.\//, '');
  value = value.replace(/^\/+/, '');
  value = value.replace(/\/+/g, '/');

  if (value.toLowerCase().endsWith(MARKDOWN_EXT)) {
    value = value.slice(0, -MARKDOWN_EXT.length);
  }

  return normalizeString(value);
}

function toNodeId(relativePath) {
  const normalized = toPosixPath(relativePath);
  return normalized.toLowerCase().endsWith(MARKDOWN_EXT)
    ? normalized.slice(0, -MARKDOWN_EXT.length)
    : normalized;
}

function inferCategory(id) {
  const category = id.split('/')[0];
  return normalizeString(category) || 'root';
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map(normalizeString).filter(Boolean);
  }
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => normalizeString(tag))
      .filter(Boolean);
  }
  return [];
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toDisplayTitle(id) {
  const base = path.posix.basename(id);
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}
