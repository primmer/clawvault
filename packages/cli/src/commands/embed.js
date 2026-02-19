import { resolveVaultPath } from '@versatly/clawvault-core/lib/config.js';
import { hasQmd, qmdEmbed, QmdUnavailableError } from '@versatly/clawvault-core/lib/search.js';
import { loadVaultQmdConfig } from '@versatly/clawvault-core/lib/vault-qmd-config.js';
export async function embedCommand(options = {}) {
    if (!hasQmd()) {
        throw new QmdUnavailableError();
    }
    const vaultPath = resolveVaultPath({ explicitPath: options.vaultPath });
    const qmdConfig = loadVaultQmdConfig(vaultPath);
    const startedAt = new Date().toISOString();
    if (!options.quiet) {
        console.log(`Embedding pending documents for collection "${qmdConfig.qmdCollection}" (root: ${qmdConfig.qmdRoot})...`);
    }
    qmdEmbed(qmdConfig.qmdCollection);
    const finishedAt = new Date().toISOString();
    if (!options.quiet) {
        console.log(`✓ Embedding complete for "${qmdConfig.qmdCollection}"`);
    }
    return {
        vaultPath,
        qmdCollection: qmdConfig.qmdCollection,
        qmdRoot: qmdConfig.qmdRoot,
        startedAt,
        finishedAt
    };
}
export function registerEmbedCommand(program) {
    program
        .command('embed')
        .description('Run qmd embedding for pending vault documents')
        .option('-v, --vault <path>', 'Vault path')
        .action(async (rawOptions) => {
        await embedCommand({
            vaultPath: rawOptions.vault
        });
    });
}
//# sourceMappingURL=embed.js.map