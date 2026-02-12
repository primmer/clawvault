import { Command } from 'commander';

type ContextFormat = 'markdown' | 'json';
interface ContextOptions {
    vaultPath: string;
    limit?: number;
    format?: ContextFormat;
    recent?: boolean;
    includeObservations?: boolean;
    budget?: number;
}
interface ContextEntry {
    title: string;
    path: string;
    category: string;
    score: number;
    snippet: string;
    modified: string;
    age: string;
    source: 'observation' | 'daily-note' | 'search';
}
interface ContextResult {
    task: string;
    generated: string;
    context: ContextEntry[];
    markdown: string;
}
declare function formatContextMarkdown(task: string, entries: ContextEntry[]): string;
declare function buildContext(task: string, options: ContextOptions): Promise<ContextResult>;
declare function contextCommand(task: string, options: ContextOptions): Promise<void>;
declare function registerContextCommand(program: Command): void;

export { type ContextEntry, type ContextFormat, type ContextOptions, type ContextResult, buildContext, contextCommand, formatContextMarkdown, registerContextCommand };
