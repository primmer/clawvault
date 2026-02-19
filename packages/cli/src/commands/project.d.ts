/**
 * Project command for ClawVault
 * Manages project add/update/archive/list/show/tasks/board operations
 */
import { type Project, type ProjectStatus } from '@versatly/clawvault-core/lib/project-utils.js';
export interface ProjectAddOptions {
    status?: ProjectStatus;
    owner?: string;
    team?: string[];
    client?: string;
    tags?: string[];
    description?: string;
    deadline?: string;
    repo?: string;
    url?: string;
    content?: string;
}
export interface ProjectUpdateOptions {
    status?: ProjectStatus;
    owner?: string | null;
    team?: string[] | null;
    client?: string | null;
    tags?: string[] | null;
    description?: string | null;
    deadline?: string | null;
    repo?: string | null;
    url?: string | null;
}
export interface ProjectArchiveOptions {
    reason?: string;
}
export interface ProjectListOptions {
    status?: ProjectStatus;
    owner?: string;
    client?: string;
    tag?: string;
    json?: boolean;
}
export interface ProjectShowOptions {
    json?: boolean;
}
export interface ProjectTasksOptions {
    json?: boolean;
}
export type ProjectBoardGroupBy = 'status' | 'owner' | 'client';
export interface ProjectBoardOptions {
    output?: string;
    groupBy?: ProjectBoardGroupBy | string;
    now?: Date;
}
export interface ProjectBoardLane {
    name: string;
    cards: string[];
}
export interface ProjectBoardResult {
    outputPath: string;
    groupBy: ProjectBoardGroupBy;
    markdown: string;
    lanes: ProjectBoardLane[];
    projectCount: number;
}
export declare function buildProjectBoardLanes(projects: Project[], groupBy: ProjectBoardGroupBy): ProjectBoardLane[];
export declare function generateProjectBoardMarkdown(projects: Project[], options?: {
    groupBy?: ProjectBoardGroupBy | string;
    now?: Date;
}): string;
export declare function syncProjectBoard(vaultPath: string, options?: ProjectBoardOptions): ProjectBoardResult;
export declare function projectAdd(vaultPath: string, title: string, options?: ProjectAddOptions): Project;
export declare function projectUpdate(vaultPath: string, slug: string, options: ProjectUpdateOptions): Project;
export declare function projectArchive(vaultPath: string, slug: string, options?: ProjectArchiveOptions): Project;
export declare function projectList(vaultPath: string, options?: ProjectListOptions): Project[];
export declare function formatProjectList(projects: Project[]): string;
export declare function formatProjectDetails(vaultPath: string, project: Project, options?: {
    activityLimit?: number;
}): string;
export declare function projectCommand(vaultPath: string, action: 'add' | 'update' | 'archive' | 'list' | 'show' | 'tasks' | 'board', args: {
    title?: string;
    slug?: string;
    options?: ProjectAddOptions & ProjectUpdateOptions & ProjectArchiveOptions & ProjectListOptions & ProjectShowOptions & ProjectTasksOptions & ProjectBoardOptions;
}): Promise<void>;
//# sourceMappingURL=project.d.ts.map