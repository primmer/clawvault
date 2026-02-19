/**
 * Blocked command for ClawVault
 * Quick view of blocked tasks
 */
import { type Task } from '@versatly/clawvault-core/lib/task-utils.js';
export interface BlockedOptions {
    project?: string;
    json?: boolean;
    escalated?: boolean;
}
/**
 * Get blocked tasks
 */
export declare function blockedList(vaultPath: string, options?: BlockedOptions): Task[];
/**
 * Format blocked tasks for terminal display
 */
export declare function formatBlockedList(tasks: Task[]): string;
/**
 * Blocked command handler for CLI
 */
export declare function blockedCommand(vaultPath: string, options?: BlockedOptions): Promise<void>;
//# sourceMappingURL=blocked.d.ts.map