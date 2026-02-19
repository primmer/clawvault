import type { Command } from 'commander';
export interface EmbedCommandOptions {
    vaultPath?: string;
    quiet?: boolean;
}
export interface EmbedCommandResult {
    vaultPath: string;
    qmdCollection: string;
    qmdRoot: string;
    startedAt: string;
    finishedAt: string;
}
export declare function embedCommand(options?: EmbedCommandOptions): Promise<EmbedCommandResult>;
export declare function registerEmbedCommand(program: Command): void;
//# sourceMappingURL=embed.d.ts.map