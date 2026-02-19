import type { SessionRecap } from '@versatly/clawvault-core/types.js';
import { type RecoveryInfo } from './recover.js';
export interface WakeOptions {
    vaultPath: string;
    handoffLimit?: number;
    brief?: boolean;
    /** Skip LLM executive summary generation (useful for tests/offline) */
    noSummary?: boolean;
}
export interface WakeResult {
    recovery: RecoveryInfo;
    recap: SessionRecap;
    recapMarkdown: string;
    summary: string;
    observations: string;
}
export declare function buildWakeSummary(recovery: RecoveryInfo, recap: SessionRecap): string;
export declare function wake(options: WakeOptions): Promise<WakeResult>;
//# sourceMappingURL=wake.d.ts.map