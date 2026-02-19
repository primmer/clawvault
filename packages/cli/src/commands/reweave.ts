import type { Command } from 'commander';
import { resolveVaultPath } from '@versatly/clawvault-core/lib/config.js';
import { reweave, type ReweaveOptions } from '@versatly/clawvault-core/lib/reweave.js';

export interface ReweaveCommandOptions {
  vaultPath?: string;
  since?: string;
  dryRun?: boolean;
  threshold?: number;
}

export async function reweaveCommand(options: ReweaveCommandOptions): Promise<void> {
  const vaultPath = resolveVaultPath({ explicitPath: options.vaultPath });
  
  const result = reweave({
    vaultPath,
    since: options.since,
    dryRun: options.dryRun,
    similarityThreshold: options.threshold,
  });

  console.log(`Reweave: scanned ${result.filesScanned} files, checked ${result.observationsChecked} observations`);

  if (result.supersessions.length === 0) {
    console.log('No knowledge updates detected.');
    return;
  }

  console.log(`\nFound ${result.supersessions.length} supersession(s):`);
  for (const s of result.supersessions) {
    console.log(`\n  OLD [${s.oldObservation.date}] ${s.oldObservation.content.slice(0, 80)}`);
    console.log(`  NEW [${s.newObservation.date}] ${s.newObservation.content.slice(0, 80)}`);
    console.log(`  Reason: ${s.reason}`);
  }

  if (result.dryRun) {
    console.log('\n(dry run — no files modified)');
  } else {
    console.log(`\n${result.supersessions.length} observation(s) marked as superseded.`);
  }
}

export function registerReweaveCommand(program: Command): void {
  program
    .command('reweave')
    .description('Backward memory consolidation — detect and mark superseded observations')
    .option('--since <date>', 'Only check observations since this date (YYYY-MM-DD)')
    .option('--dry-run', 'Show what would be superseded without writing')
    .option('--threshold <n>', 'Entity similarity threshold (0-1, default 0.3)', '0.3')
    .option('-v, --vault <path>', 'Vault path')
    .action(async (rawOptions: { since?: string; dryRun?: boolean; threshold: string; vault?: string }) => {
      await reweaveCommand({
        vaultPath: rawOptions.vault,
        since: rawOptions.since,
        dryRun: rawOptions.dryRun,
        threshold: parseFloat(rawOptions.threshold),
      });
    });
}
