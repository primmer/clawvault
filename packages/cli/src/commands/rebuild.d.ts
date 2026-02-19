import type { Command } from 'commander';
export interface RebuildCommandOptions {
    vaultPath?: string;
    from?: string;
    to?: string;
}
export declare function rebuildCommand(options: RebuildCommandOptions): Promise<void>;
export declare function registerRebuildCommand(program: Command): void;
//# sourceMappingURL=rebuild.d.ts.map