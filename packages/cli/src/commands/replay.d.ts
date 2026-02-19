import type { Command } from 'commander';
import type { ReplaySource } from '@versatly/clawvault-core/replay/types.js';
export interface ReplayCommandOptions {
    source: ReplaySource;
    inputPath: string;
    from?: string;
    to?: string;
    dryRun?: boolean;
    vaultPath?: string;
}
export declare function replayCommand(options: ReplayCommandOptions): Promise<void>;
export declare function registerReplayCommand(program: Command): void;
//# sourceMappingURL=replay.d.ts.map