import type { Command } from 'commander';
import { resolveVaultPath } from '../lib/config.js';
import { hasQmd, qmdEmbed, QmdUnavailableError } from '../lib/search.js';
import { loadVaultQmdConfig } from '../lib/vault-qmd-config.js';
import { listQmdCollections, type QmdCollectionInfo } from '../lib/qmd-collections.js';

export interface EmbedCommandOptions {
  vaultPath?: string;
  quiet?: boolean;
  force?: boolean;
}

export interface EmbedCommandResult {
  vaultPath: string;
  qmdCollection: string;
  qmdRoot: string;
  startedAt: string;
  finishedAt: string;
  usedForce: boolean;
  rebuiltFromEmptyVectors: boolean;
  files?: number;
  vectors?: number;
}

function readCollectionInfo(collectionName: string): QmdCollectionInfo | undefined {
  try {
    return listQmdCollections().find((collection) => collection.name === collectionName);
  } catch {
    return undefined;
  }
}

function hasEmptyVectors(collection: QmdCollectionInfo | undefined): boolean {
  if (!collection) return false;
  if ((collection.files ?? 0) <= 0) return false;
  return (collection.vectors ?? 0) <= 0;
}

export async function embedCommand(options: EmbedCommandOptions = {}): Promise<EmbedCommandResult> {
  if (!hasQmd()) {
    throw new QmdUnavailableError();
  }

  const vaultPath = resolveVaultPath({ explicitPath: options.vaultPath });
  const qmdConfig = loadVaultQmdConfig(vaultPath);
  const startedAt = new Date().toISOString();

  if (!options.quiet) {
    console.log(
      `Embedding pending documents for collection "${qmdConfig.qmdCollection}" (root: ${qmdConfig.qmdRoot})...`
    );
  }

  const requestedForce = Boolean(options.force);
  if (requestedForce) {
    qmdEmbed(qmdConfig.qmdCollection, undefined, { force: true });
  } else {
    qmdEmbed(qmdConfig.qmdCollection);
  }

  let rebuiltFromEmptyVectors = false;
  let collectionInfo = readCollectionInfo(qmdConfig.qmdCollection);
  if (!requestedForce && hasEmptyVectors(collectionInfo)) {
    if (!options.quiet) {
      console.log('⚠ Detected empty qmd vectors despite indexed files; retrying with --force rebuild...');
    }
    qmdEmbed(qmdConfig.qmdCollection, undefined, { force: true });
    rebuiltFromEmptyVectors = true;
    collectionInfo = readCollectionInfo(qmdConfig.qmdCollection);
  }

  const finishedAt = new Date().toISOString();
  if (!options.quiet) {
    console.log(`✓ Embedding complete for "${qmdConfig.qmdCollection}"`);
    if (collectionInfo?.vectors !== undefined) {
      console.log(`  Files: ${collectionInfo.files ?? 'unknown'} | Vectors: ${collectionInfo.vectors}`);
    }
  }

  return {
    vaultPath,
    qmdCollection: qmdConfig.qmdCollection,
    qmdRoot: qmdConfig.qmdRoot,
    startedAt,
    finishedAt,
    usedForce: requestedForce || rebuiltFromEmptyVectors,
    rebuiltFromEmptyVectors,
    files: collectionInfo?.files,
    vectors: collectionInfo?.vectors
  };
}

export function registerEmbedCommand(program: Command): void {
  program
    .command('embed')
    .description('Run qmd embedding for pending vault documents')
    .option('-v, --vault <path>', 'Vault path')
    .option('--force', 'Force embed rebuild even when hashes look up-to-date')
    .action(async (rawOptions: { vault?: string; force?: boolean }) => {
      await embedCommand({
        vaultPath: rawOptions.vault,
        force: rawOptions.force
      });
    });
}
