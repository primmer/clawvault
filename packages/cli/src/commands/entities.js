import { buildEntityIndex } from '@versatly/clawvault-core/lib/entity-index.js';
import { resolveVaultPath } from '@versatly/clawvault-core/lib/config.js';
export async function entitiesCommand(options) {
    const vaultPath = resolveVaultPath({ explicitPath: options.vaultPath });
    const index = buildEntityIndex(vaultPath);
    if (options.json) {
        const output = {};
        for (const [path, entry] of index.byPath) {
            output[path] = entry.aliases;
        }
        console.log(JSON.stringify(output, null, 2));
        return;
    }
    // Group by folder
    const byFolder = {};
    for (const [path, entry] of index.byPath) {
        const folder = path.split('/')[0];
        if (!byFolder[folder])
            byFolder[folder] = [];
        byFolder[folder].push({ path, aliases: entry.aliases });
    }
    console.log('📚 Linkable Entities\n');
    for (const [folder, entities] of Object.entries(byFolder)) {
        console.log(`## ${folder}/`);
        for (const entity of entities) {
            const name = entity.path.split('/')[1];
            const otherAliases = entity.aliases.filter(a => a.toLowerCase() !== name.toLowerCase());
            if (otherAliases.length > 0) {
                console.log(`  - ${name} (${otherAliases.join(', ')})`);
            }
            else {
                console.log(`  - ${name}`);
            }
        }
        console.log();
    }
    console.log(`Total: ${index.byPath.size} entities, ${index.entries.size} linkable aliases`);
}
//# sourceMappingURL=entities.js.map