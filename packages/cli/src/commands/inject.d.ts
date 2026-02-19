import type { Command } from 'commander';
import { type InjectResult } from '@versatly/clawvault-core/lib/inject-utils.js';
export type InjectFormat = 'markdown' | 'json';
export interface InjectCommandOptions {
    vaultPath: string;
    maxResults?: number;
    useLlm?: boolean;
    scope?: string | string[];
    format?: InjectFormat;
    model?: string;
}
export declare function buildInjectionResult(message: string, options: InjectCommandOptions): Promise<InjectResult>;
export declare function injectCommand(message: string, options: InjectCommandOptions): Promise<void>;
export declare function registerInjectCommand(program: Command): void;
//# sourceMappingURL=inject.d.ts.map