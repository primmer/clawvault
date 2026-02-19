/**
 * repair-session command - Repair corrupted OpenClaw session transcripts
 *
 * Fixes issues like:
 * - Aborted tool calls with partial JSON
 * - Orphaned tool_result messages referencing non-existent tool_use IDs
 * - Broken parent chain references
 */
import { type SessionInfo } from '@versatly/clawvault-core/lib/session-utils.js';
import { type RepairResult } from '@versatly/clawvault-core/lib/session-repair.js';
export interface RepairSessionOptions {
    sessionId?: string;
    agentId?: string;
    backup?: boolean;
    dryRun?: boolean;
}
/**
 * Resolve the session to repair
 */
export declare function resolveSession(options: RepairSessionOptions): SessionInfo | null;
/**
 * Format repair result for CLI output
 */
export declare function formatRepairResult(result: RepairResult, options?: {
    dryRun?: boolean;
}): string;
/**
 * Main repair-session command handler
 */
export declare function repairSessionCommand(options: RepairSessionOptions): Promise<RepairResult>;
/**
 * List available sessions for an agent (for --list flag)
 */
export declare function listAgentSessions(agentId?: string): string;
//# sourceMappingURL=repair-session.d.ts.map