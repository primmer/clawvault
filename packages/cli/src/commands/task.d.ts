/**
 * Task command for ClawVault
 * Manages task add/list/update/done/show operations
 */
import { type Task, type TaskStatus, type TaskPriority } from '@versatly/clawvault-core/lib/task-utils.js';
export interface TaskAddOptions {
    owner?: string;
    project?: string;
    priority?: TaskPriority;
    due?: string;
    content?: string;
    tags?: string[];
    description?: string;
    estimate?: string;
    parent?: string;
    dependsOn?: string[];
}
export interface TaskListOptions {
    status?: TaskStatus;
    owner?: string;
    project?: string;
    priority?: TaskPriority;
    due?: boolean;
    tag?: string;
    overdue?: boolean;
    json?: boolean;
}
export interface TaskUpdateOptions {
    status?: TaskStatus;
    owner?: string | null;
    project?: string | null;
    priority?: TaskPriority | null;
    blockedBy?: string | null;
    due?: string | null;
    tags?: string[] | null;
    description?: string | null;
    estimate?: string | null;
    parent?: string | null;
    dependsOn?: string[] | null;
    confidence?: number;
    reason?: string | null;
}
export interface TaskTransitionsOptions {
    agent?: string;
    failed?: boolean;
    json?: boolean;
}
export interface TaskShowOptions {
    json?: boolean;
}
/**
 * Add a new task
 */
export declare function taskAdd(vaultPath: string, title: string, options?: TaskAddOptions): Task;
/**
 * List tasks with optional filters
 */
export declare function taskList(vaultPath: string, options?: TaskListOptions): Task[];
/**
 * Update a task
 */
export declare function taskUpdate(vaultPath: string, slug: string, options: TaskUpdateOptions): Task;
/**
 * Mark a task as done
 */
export declare function taskDone(vaultPath: string, slug: string, options?: {
    confidence?: number;
    reason?: string;
}): Task;
/**
 * Query task transitions
 */
export declare function taskTransitions(vaultPath: string, taskId?: string, options?: TaskTransitionsOptions): string;
/**
 * Show task details
 */
export declare function taskShow(vaultPath: string, slug: string): Task | null;
/**
 * Format task list as terminal table
 */
export declare function formatTaskList(tasks: Task[]): string;
/**
 * Format task details for display
 */
export declare function formatTaskDetails(task: Task): string;
/**
 * Task command handler for CLI
 */
export declare function taskCommand(vaultPath: string, action: 'add' | 'list' | 'update' | 'done' | 'show' | 'transitions', args: {
    title?: string;
    slug?: string;
    options?: TaskAddOptions & TaskListOptions & TaskUpdateOptions & TaskShowOptions & TaskTransitionsOptions;
}): Promise<void>;
//# sourceMappingURL=task.d.ts.map