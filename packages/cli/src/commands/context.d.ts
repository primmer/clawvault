import type { Command } from 'commander';
import { type ResolvedContextProfile } from '@versatly/clawvault-core/lib/context-profile.js';
export type ContextFormat = 'markdown' | 'json';
export type ContextProfile = ResolvedContextProfile;
export type ContextProfileOption = ContextProfile | 'auto';
export interface ContextOptions {
    vaultPath: string;
    limit?: number;
    format?: ContextFormat;
    recent?: boolean;
    includeObservations?: boolean;
    budget?: number;
    profile?: ContextProfileOption;
    maxHops?: number;
}
export interface ContextEntry {
    title: string;
    path: string;
    category: string;
    score: number;
    snippet: string;
    modified: string;
    age: string;
    source: 'observation' | 'daily-note' | 'search' | 'graph';
    signals?: string[];
    rationale?: string;
}
export interface ContextResult {
    task: string;
    profile: ContextProfile;
    generated: string;
    context: ContextEntry[];
    markdown: string;
}
export declare function formatContextMarkdown(task: string, entries: ContextEntry[]): string;
export declare function buildContext(task: string, options: ContextOptions): Promise<ContextResult>;
export declare function contextCommand(task: string, options: ContextOptions): Promise<void>;
export declare function registerContextCommand(program: Command): void;
//# sourceMappingURL=context.d.ts.map