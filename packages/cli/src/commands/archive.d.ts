import type { Command } from 'commander';
export interface ArchiveCommandOptions {
    vaultPath?: string;
    olderThan?: number;
    dryRun?: boolean;
}
export declare function archiveCommand(options: ArchiveCommandOptions): Promise<void>;
export declare function registerArchiveCommand(program: Command): void;
//# sourceMappingURL=archive.d.ts.map