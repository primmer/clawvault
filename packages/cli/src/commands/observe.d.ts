import type { Command } from 'commander';
export interface ObserveCommandOptions {
    watch?: string;
    threshold?: number;
    reflectThreshold?: number;
    model?: string;
    extractTasks?: boolean;
    compress?: string;
    daemon?: boolean;
    vaultPath?: string;
    active?: boolean;
    agent?: string;
    minNew?: number;
    sessionsDir?: string;
    dryRun?: boolean;
    cron?: boolean;
    maxSessions?: number;
}
export declare function observeCommand(options: ObserveCommandOptions): Promise<void>;
export declare function registerObserveCommand(program: Command): void;
//# sourceMappingURL=observe.d.ts.map