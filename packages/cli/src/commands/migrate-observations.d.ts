import type { Command } from 'commander';
export interface MigrateObservationsOptions {
    vaultPath?: string;
    dryRun?: boolean;
}
export interface MigrateObservationsResult {
    scanned: number;
    migrated: number;
    backups: number;
    dryRun: boolean;
}
export declare function migrateObservations(vaultPath: string, options?: {
    dryRun?: boolean;
}): MigrateObservationsResult;
export declare function migrateObservationsCommand(options: MigrateObservationsOptions): Promise<void>;
export declare function registerMigrateObservationsCommand(program: Command): void;
//# sourceMappingURL=migrate-observations.d.ts.map