import { resolveVaultPath } from '@versatly/clawvault-core/lib/config.js';
import { archiveObservations } from '@versatly/clawvault-core/observer/archive.js';
function parsePositiveInteger(raw, label) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid ${label}: ${raw}`);
    }
    return parsed;
}
export async function archiveCommand(options) {
    const vaultPath = resolveVaultPath({ explicitPath: options.vaultPath });
    const result = archiveObservations(vaultPath, {
        olderThanDays: options.olderThan,
        dryRun: options.dryRun
    });
    if (result.archived === 0) {
        console.log('No observations matched archive criteria.');
        return;
    }
    if (result.dryRun) {
        console.log(`Dry run: ${result.archived} observation file(s) would be archived.`);
        return;
    }
    console.log(`Archived ${result.archived} observation file(s).`);
}
export function registerArchiveCommand(program) {
    program
        .command('archive')
        .description('Archive old observations into ledger/archive')
        .option('--older-than <days>', 'Archive observations older than this many days', '14')
        .option('--dry-run', 'Show archive candidates without moving files')
        .option('-v, --vault <path>', 'Vault path')
        .action(async (rawOptions) => {
        await archiveCommand({
            vaultPath: rawOptions.vault,
            olderThan: parsePositiveInteger(rawOptions.olderThan, 'older-than'),
            dryRun: rawOptions.dryRun
        });
    });
}
//# sourceMappingURL=archive.js.map