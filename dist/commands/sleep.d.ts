import { H as HandoffDocument, D as Document } from '../types-DMU3SuAV.js';
import { C as CloudSyncResult } from '../types-CilEQY9w.js';

type PromptFn = (question: string) => Promise<string>;
interface SleepOptions {
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
    prompt?: PromptFn;
    cwd?: string;
}
interface GitCommitResult {
    repoRoot?: string;
    dirtyCount?: number;
    committed: boolean;
    message?: string;
    skippedReason?: string;
}
interface SleepResult {
    handoff: HandoffDocument;
    document: Document;
    git?: GitCommitResult;
    cloudSync?: CloudSyncResult;
    observationRoutingSummary?: string;
}
declare function sleep(options: SleepOptions): Promise<SleepResult>;

export { type GitCommitResult, type PromptFn, type SleepOptions, type SleepResult, sleep };
