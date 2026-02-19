import type { Command } from 'commander';
export interface ReflectCommandOptions {
    vaultPath?: string;
    days?: number;
    dryRun?: boolean;
}
export declare function reflectCommand(options: ReflectCommandOptions): Promise<void>;
export declare function registerReflectCommand(program: Command): void;
//# sourceMappingURL=reflect.d.ts.map