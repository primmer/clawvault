export type CompatStatus = 'ok' | 'warn' | 'error';
export interface CompatCheck {
    label: string;
    status: CompatStatus;
    detail?: string;
    hint?: string;
}
export interface CompatReport {
    generatedAt: string;
    checks: CompatCheck[];
    warnings: number;
    errors: number;
}
interface CompatOptions {
    baseDir?: string;
}
export interface CompatCommandOptions {
    json?: boolean;
    strict?: boolean;
    baseDir?: string;
}
export declare function checkOpenClawCompatibility(options?: CompatOptions): CompatReport;
export declare function compatibilityExitCode(report: CompatReport, options?: {
    strict?: boolean;
}): number;
export declare function compatCommand(options?: CompatCommandOptions): Promise<CompatReport>;
export {};
//# sourceMappingURL=compat.d.ts.map