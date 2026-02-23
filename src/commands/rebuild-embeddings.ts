/**
 * Rebuild embedding cache for hybrid search.
 * Uses @huggingface/transformers (all-MiniLM-L6-v2) for local embeddings.
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveVaultPath } from '../lib/config.js';
import { EmbeddingCache, embed } from '../lib/hybrid-search.js';

export interface RebuildEmbeddingsOptions {
  force?: boolean;
  onProgress?: (current: number, total: number) => void;
}

export interface RebuildEmbeddingsResult {
  total: number;
  added: number;
  skipped: number;
}

function walkDir(dir: string, base: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        files.push(...walkDir(full, base));
      } else if (entry.endsWith('.md')) {
        files.push(path.relative(base, full));
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return files;
}

/**
 * Rebuild embeddings for all markdown files in a vault.
 */
export async function rebuildEmbeddingsForVault(
  vaultPath: string,
  options: RebuildEmbeddingsOptions = {}
): Promise<RebuildEmbeddingsResult> {
  const { force = false, onProgress } = options;

  const cache = new EmbeddingCache(vaultPath);
  if (!force) {
    cache.load();
  }

  const mdFiles = walkDir(vaultPath, vaultPath).filter(
    (f) => !f.startsWith('node_modules') && !f.startsWith('.')
  );

  let added = 0;
  let skipped = 0;

  for (let i = 0; i < mdFiles.length; i++) {
    const file = mdFiles[i];
    const docId = file.replace(/\.md$/, '');

    if (!force && cache.has(docId)) {
      skipped++;
      if (onProgress) onProgress(i + 1, mdFiles.length);
      continue;
    }

    try {
      const content = fs.readFileSync(path.join(vaultPath, file), 'utf-8');
      if (content.length < 20) {
        skipped++;
        if (onProgress) onProgress(i + 1, mdFiles.length);
        continue;
      }

      const embedding = await embed(content.slice(0, 8000));
      cache.set(docId, embedding);
      added++;
    } catch {
      skipped++;
    }

    if (onProgress) onProgress(i + 1, mdFiles.length);
  }

  cache.save();

  return {
    total: cache.size,
    added,
    skipped
  };
}

export interface RebuildEmbeddingsCommandOptions {
  vaultPath?: string;
  force?: boolean;
  quiet?: boolean;
}

export async function rebuildEmbeddingsCommand(
  options: RebuildEmbeddingsCommandOptions = {}
): Promise<RebuildEmbeddingsResult> {
  const vaultPath = resolveVaultPath({ explicitPath: options.vaultPath });

  if (!options.quiet) {
    console.log(`Rebuilding embedding cache for vault: ${vaultPath}`);
  }

  const result = await rebuildEmbeddingsForVault(vaultPath, {
    force: options.force,
    onProgress: options.quiet
      ? undefined
      : (current, total) => {
          process.stdout.write(`\r  Embedding ${current}/${total} documents...`);
        }
  });

  if (!options.quiet) {
    console.log(`\n✓ Done. ${result.total} embeddings (${result.added} new, ${result.skipped} cached)`);
  }

  return result;
}
