import type { Command } from 'commander';
export interface ReweaveCommandOptions {
    vaultPath?: string;
    since?: string;
    dryRun?: boolean;
    threshold?: number;
}
export declare function reweaveCommand(options: ReweaveCommandOptions): Promise<void>;
export declare function registerReweaveCommand(program: Command): void;
//# sourceMappingURL=reweave.d.ts.map