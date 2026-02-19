/**
 * Kanban command for ClawVault.
 * Syncs task frontmatter to/from Obsidian Kanban markdown boards.
 */
import { type Task } from '@versatly/clawvault-core/lib/task-utils.js';
export type KanbanGroupBy = 'status' | 'priority' | 'project' | 'owner';
export interface KanbanSyncOptions {
    output?: string;
    groupBy?: KanbanGroupBy | string;
    filterProject?: string;
    filterOwner?: string;
    includeDone?: boolean;
    now?: Date;
}
export interface KanbanImportOptions {
    output?: string;
}
export interface KanbanLane {
    name: string;
    cards: string[];
}
export interface KanbanSyncResult {
    outputPath: string;
    groupBy: KanbanGroupBy;
    markdown: string;
    lanes: KanbanLane[];
    taskCount: number;
}
export interface KanbanImportChange {
    slug: string;
    field: KanbanGroupBy;
    from: string | null;
    to: string | null;
}
export interface KanbanImportResult {
    outputPath: string;
    groupBy: KanbanGroupBy;
    changes: KanbanImportChange[];
    missingSlugs: string[];
}
export interface ParsedKanbanLane {
    name: string;
    slugs: string[];
}
export interface ParsedKanbanBoard {
    groupBy: KanbanGroupBy;
    lanes: ParsedKanbanLane[];
}
export declare function formatKanbanCard(task: Task): string;
export declare function buildKanbanLanes(tasks: Task[], groupBy: KanbanGroupBy): KanbanLane[];
export declare function generateKanbanMarkdown(tasks: Task[], options?: {
    groupBy?: KanbanGroupBy | string;
    now?: Date;
}): string;
export declare function syncKanbanBoard(vaultPath: string, options?: KanbanSyncOptions): KanbanSyncResult;
export declare function extractCardSlug(line: string): string | null;
export declare function parseKanbanMarkdown(markdown: string): ParsedKanbanBoard;
export declare function importKanbanBoard(vaultPath: string, options?: KanbanImportOptions): KanbanImportResult;
export declare function kanbanCommand(vaultPath: string, action: 'sync' | 'import', options?: KanbanSyncOptions & KanbanImportOptions): Promise<void>;
//# sourceMappingURL=kanban.d.ts.map