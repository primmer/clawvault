import type { Document, HandoffDocument } from '@versatly/clawvault-core/types.js';
export type PromptFn = (question: string) => Promise<string>;
export interface SleepOptions {
    workingOn: string;
    next?: string;
    blocked?: string;
    decisions?: string;
    questions?: string;
    feeling?: string;
    sessionKey?: string;
    vaultPath: string;
    index?: boolean;
    git?: boolean;
    sessionTranscript?: string;
    reflect?: boolean;
    qmdIndexName?: string;
    prompt?: PromptFn;
    cwd?: string;
}
export interface GitCommitResult {
    repoRoot?: string;
    dirtyCount?: number;
    committed: boolean;
    message?: string;
    skippedReason?: string;
}
export interface SleepResult {
    handoff: HandoffDocument;
    document: Document;
    git?: GitCommitResult;
    observationRoutingSummary?: string;
}
export declare function sleep(options: SleepOptions): Promise<SleepResult>;
//# sourceMappingURL=sleep.d.ts.map