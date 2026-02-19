/**
 * Backlog command for ClawVault
 * Manages backlog add/list/promote operations
 */
import { type BacklogItem, type TaskPriority, type Task } from '@versatly/clawvault-core/lib/task-utils.js';
export interface BacklogAddOptions {
    source?: string;
    project?: string;
    content?: string;
    tags?: string[];
}
export interface BacklogListOptions {
    project?: string;
    json?: boolean;
}
export interface BacklogPromoteOptions {
    owner?: string;
    priority?: TaskPriority;
    due?: string;
}
/**
 * Add a new backlog item
 */
export declare function backlogAdd(vaultPath: string, title: string, options?: BacklogAddOptions): BacklogItem;
/**
 * List backlog items with optional filters
 */
export declare function backlogList(vaultPath: string, options?: BacklogListOptions): BacklogItem[];
/**
 * Promote a backlog item to a task
 */
export declare function backlogPromote(vaultPath: string, slug: string, options?: BacklogPromoteOptions): Task;
/**
 * Format backlog list for terminal display
 */
export declare function formatBacklogList(items: BacklogItem[]): string;
/**
 * Format backlog item details for display
 */
export declare function formatBacklogDetails(item: BacklogItem): string;
/**
 * Backlog command handler for CLI
 * Note: The CLI uses "clawvault backlog <title>" as shorthand for add
 */
export declare function backlogCommand(vaultPath: string, action: 'add' | 'list' | 'promote', args: {
    title?: string;
    slug?: string;
    options?: BacklogAddOptions & BacklogListOptions & BacklogPromoteOptions;
}): Promise<void>;
//# sourceMappingURL=backlog.d.ts.map