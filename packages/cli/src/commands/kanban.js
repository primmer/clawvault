/**
 * Kanban command for ClawVault.
 * Syncs task frontmatter to/from Obsidian Kanban markdown boards.
 */
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { listTasks, readTask, updateTask } from '@versatly/clawvault-core/lib/task-utils.js';
const STATUS_LANES = [
    { status: 'open', name: 'Open' },
    { status: 'in-progress', name: 'In Progress' },
    { status: 'blocked', name: 'Blocked' },
    { status: 'done', name: 'Done' }
];
const PRIORITY_LANES = [
    { priority: 'critical', name: '🔥 Critical' },
    { priority: 'high', name: '🔴 High' },
    { priority: 'medium', name: '🟡 Medium' },
    { priority: 'low', name: '🟢 Low' },
    { priority: null, name: '⚪ Unset' }
];
const PRIORITY_EMOJI = {
    critical: '🔥',
    high: '🔴',
    medium: '🟡',
    low: '🟢'
};
function normalizeGroupBy(value) {
    const normalized = String(value || 'status').trim().toLowerCase();
    if (normalized === 'status' || normalized === 'priority' || normalized === 'project' || normalized === 'owner') {
        return normalized;
    }
    throw new Error(`Unsupported kanban group field: ${normalized}`);
}
function resolveBoardPath(vaultPath, output) {
    const resolvedVaultPath = path.resolve(vaultPath);
    if (!output) {
        return path.join(resolvedVaultPath, 'Board.md');
    }
    if (path.isAbsolute(output)) {
        return output;
    }
    return path.join(resolvedVaultPath, output);
}
function toHashTag(value) {
    return value
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^A-Za-z0-9/_-]/g, '');
}
function toMention(value) {
    return value
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^A-Za-z0-9._-]/g, '');
}
function dateOnly(value) {
    return value.includes('T') ? value.split('T')[0] : value;
}
function dueTimestamp(task) {
    if (!task.frontmatter.due)
        return Number.POSITIVE_INFINITY;
    const timestamp = Date.parse(task.frontmatter.due);
    return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}
function sortTasksForCards(tasks) {
    return [...tasks].sort((left, right) => {
        const dueDiff = dueTimestamp(left) - dueTimestamp(right);
        if (dueDiff !== 0)
            return dueDiff;
        return new Date(right.frontmatter.created).getTime() - new Date(left.frontmatter.created).getTime();
    });
}
function statusLaneName(status) {
    const lane = STATUS_LANES.find((entry) => entry.status === status);
    return lane ? lane.name : 'Open';
}
function priorityLaneName(priority) {
    const lane = PRIORITY_LANES.find((entry) => entry.priority === (priority ?? null));
    return lane ? lane.name : '⚪ Unset';
}
function laneNameForTask(task, groupBy) {
    switch (groupBy) {
        case 'status':
            return statusLaneName(task.frontmatter.status);
        case 'priority':
            return priorityLaneName(task.frontmatter.priority);
        case 'project':
            return task.frontmatter.project?.trim() || 'No Project';
        case 'owner':
            return task.frontmatter.owner?.trim() || 'Unassigned';
        default:
            return statusLaneName(task.frontmatter.status);
    }
}
function defaultLaneOrder(groupBy, tasks) {
    if (groupBy === 'status') {
        return STATUS_LANES.map((entry) => entry.name);
    }
    if (groupBy === 'priority') {
        return PRIORITY_LANES.map((entry) => entry.name);
    }
    const fallback = groupBy === 'project' ? 'No Project' : 'Unassigned';
    const values = new Set();
    for (const task of tasks) {
        values.add(laneNameForTask(task, groupBy));
    }
    if (values.size === 0) {
        return [fallback];
    }
    const sorted = Array.from(values).sort((left, right) => left.localeCompare(right));
    if (sorted.includes(fallback)) {
        return [...sorted.filter((value) => value !== fallback), fallback];
    }
    return sorted;
}
export function formatKanbanCard(task) {
    const checkbox = task.frontmatter.status === 'done' ? 'x' : ' ';
    const parts = [];
    if (task.frontmatter.priority) {
        parts.push(PRIORITY_EMOJI[task.frontmatter.priority]);
    }
    parts.push(`[[${task.slug}|${task.title}]]`);
    if (task.frontmatter.project) {
        const projectTag = toHashTag(task.frontmatter.project);
        if (projectTag)
            parts.push(`#${projectTag}`);
    }
    if (task.frontmatter.owner) {
        const mention = toMention(task.frontmatter.owner);
        if (mention)
            parts.push(`@${mention}`);
    }
    if (task.frontmatter.tags && task.frontmatter.tags.length > 0) {
        for (const tag of task.frontmatter.tags) {
            const normalizedTag = toHashTag(tag);
            if (normalizedTag)
                parts.push(`#${normalizedTag}`);
        }
    }
    if (task.frontmatter.due) {
        parts.push(`📅 ${dateOnly(task.frontmatter.due)}`);
    }
    if (task.frontmatter.status === 'blocked' || task.frontmatter.blocked_by) {
        parts.push('⛔');
    }
    return `- [${checkbox}] ${parts.join(' ')}`;
}
export function buildKanbanLanes(tasks, groupBy) {
    const laneOrder = defaultLaneOrder(groupBy, tasks);
    const lanes = new Map();
    for (const laneName of laneOrder) {
        lanes.set(laneName, []);
    }
    for (const task of sortTasksForCards(tasks)) {
        const laneName = laneNameForTask(task, groupBy);
        if (!lanes.has(laneName)) {
            lanes.set(laneName, []);
        }
        lanes.get(laneName)?.push(formatKanbanCard(task));
    }
    return Array.from(lanes.entries()).map(([name, cards]) => ({ name, cards }));
}
export function generateKanbanMarkdown(tasks, options = {}) {
    const groupBy = normalizeGroupBy(options.groupBy);
    const syncedAt = (options.now || new Date()).toISOString();
    const lanes = buildKanbanLanes(tasks, groupBy);
    const sections = lanes.map((lane) => {
        const cardsBlock = lane.cards.length > 0 ? lane.cards.join('\n') : '';
        return `## ${lane.name}\n\n${cardsBlock}`.trimEnd();
    }).join('\n\n');
    return [
        '---',
        'kanban-plugin: basic',
        `clawvault-group-by: ${groupBy}`,
        `clawvault-last-sync: '${syncedAt}'`,
        '---',
        '',
        sections,
        '',
        '%% kanban:settings',
        '{"kanban-plugin":"basic","list-collapse":["Done"],"show-checkboxes":true}',
        '%%',
        ''
    ].join('\n');
}
export function syncKanbanBoard(vaultPath, options = {}) {
    const groupBy = normalizeGroupBy(options.groupBy);
    const outputPath = resolveBoardPath(vaultPath, options.output);
    let tasks = listTasks(vaultPath);
    if (options.filterProject) {
        tasks = tasks.filter((task) => task.frontmatter.project === options.filterProject);
    }
    if (options.filterOwner) {
        tasks = tasks.filter((task) => task.frontmatter.owner === options.filterOwner);
    }
    if (!options.includeDone) {
        tasks = tasks.filter((task) => task.frontmatter.status !== 'done');
    }
    const markdown = generateKanbanMarkdown(tasks, {
        groupBy,
        now: options.now
    });
    fs.writeFileSync(outputPath, markdown);
    return {
        outputPath,
        groupBy,
        markdown,
        lanes: buildKanbanLanes(tasks, groupBy),
        taskCount: tasks.length
    };
}
function normalizeLaneKey(laneName) {
    return laneName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function statusFromLaneName(laneName) {
    const key = normalizeLaneKey(laneName);
    if (key.includes('in progress') || key.includes('in-progress') || key === 'active')
        return 'in-progress';
    if (key.includes('blocked'))
        return 'blocked';
    if (key.includes('done') || key.includes('complete'))
        return 'done';
    if (key.includes('open'))
        return 'open';
    return null;
}
function priorityFromLaneName(laneName) {
    const key = normalizeLaneKey(laneName);
    if (key.includes('critical'))
        return 'critical';
    if (key.includes('high'))
        return 'high';
    if (key.includes('medium'))
        return 'medium';
    if (key.includes('low'))
        return 'low';
    if (key.includes('unset') || key.includes('none') || key.includes('no priority'))
        return null;
    return undefined;
}
function isProjectFallbackLane(laneName) {
    const key = normalizeLaneKey(laneName);
    return key === 'no project' || key === 'none';
}
function isOwnerFallbackLane(laneName) {
    const key = normalizeLaneKey(laneName);
    return key === 'unassigned' || key === 'none';
}
export function extractCardSlug(line) {
    const wikiMatch = line.match(/\[\[([^\]]+)\]\]/);
    if (!wikiMatch)
        return null;
    let target = wikiMatch[1].split('|')[0].trim();
    if (!target)
        return null;
    target = target.split('#')[0].trim();
    const filePart = target.split('/').pop() || target;
    const slug = filePart.replace(/\.md$/i, '').trim();
    return slug || null;
}
export function parseKanbanMarkdown(markdown) {
    const parsed = matter(markdown);
    const groupBy = normalizeGroupBy(typeof parsed.data['clawvault-group-by'] === 'string'
        ? parsed.data['clawvault-group-by']
        : undefined);
    const lanes = [];
    const laneByName = new Map();
    let currentLane = null;
    const lines = parsed.content.split(/\r?\n/);
    for (const line of lines) {
        const headerMatch = line.match(/^##\s+(.+?)\s*$/);
        if (headerMatch) {
            const laneName = headerMatch[1].trim();
            if (!laneByName.has(laneName)) {
                const lane = { name: laneName, slugs: [] };
                laneByName.set(laneName, lane);
                lanes.push(lane);
            }
            currentLane = laneByName.get(laneName) || null;
            continue;
        }
        if (!currentLane || !/^\s*-\s*\[[ xX]\]\s+/.test(line)) {
            continue;
        }
        const slug = extractCardSlug(line);
        if (slug) {
            currentLane.slugs.push(slug);
        }
    }
    return { groupBy, lanes };
}
function hasUpdates(updates) {
    return Object.keys(updates).length > 0;
}
export function importKanbanBoard(vaultPath, options = {}) {
    const outputPath = resolveBoardPath(vaultPath, options.output);
    if (!fs.existsSync(outputPath)) {
        throw new Error(`Kanban board not found: ${outputPath}`);
    }
    const markdown = fs.readFileSync(outputPath, 'utf-8');
    const parsed = parseKanbanMarkdown(markdown);
    const changes = [];
    const missingSlugs = [];
    const seenSlugs = new Set();
    for (const lane of parsed.lanes) {
        for (const slug of lane.slugs) {
            if (seenSlugs.has(slug))
                continue;
            seenSlugs.add(slug);
            const task = readTask(vaultPath, slug);
            if (!task) {
                missingSlugs.push(slug);
                continue;
            }
            const updates = {};
            if (parsed.groupBy === 'status') {
                const desiredStatus = statusFromLaneName(lane.name);
                if (desiredStatus && task.frontmatter.status !== desiredStatus) {
                    updates.status = desiredStatus;
                    changes.push({
                        slug,
                        field: 'status',
                        from: task.frontmatter.status,
                        to: desiredStatus
                    });
                }
            }
            else if (parsed.groupBy === 'priority') {
                const desiredPriority = priorityFromLaneName(lane.name);
                if (desiredPriority !== undefined) {
                    const currentPriority = task.frontmatter.priority ?? null;
                    if (currentPriority !== desiredPriority) {
                        updates.priority = desiredPriority;
                        changes.push({
                            slug,
                            field: 'priority',
                            from: currentPriority,
                            to: desiredPriority
                        });
                    }
                }
            }
            else if (parsed.groupBy === 'project') {
                const desiredProject = isProjectFallbackLane(lane.name) ? null : lane.name.trim();
                const currentProject = task.frontmatter.project ?? null;
                if (currentProject !== desiredProject) {
                    updates.project = desiredProject;
                    changes.push({
                        slug,
                        field: 'project',
                        from: currentProject,
                        to: desiredProject
                    });
                }
            }
            else if (parsed.groupBy === 'owner') {
                const desiredOwner = isOwnerFallbackLane(lane.name) ? null : lane.name.trim();
                const currentOwner = task.frontmatter.owner ?? null;
                if (currentOwner !== desiredOwner) {
                    updates.owner = desiredOwner;
                    changes.push({
                        slug,
                        field: 'owner',
                        from: currentOwner,
                        to: desiredOwner
                    });
                }
            }
            if (hasUpdates(updates)) {
                updateTask(vaultPath, slug, updates);
            }
        }
    }
    return {
        outputPath,
        groupBy: parsed.groupBy,
        changes,
        missingSlugs
    };
}
export async function kanbanCommand(vaultPath, action, options = {}) {
    if (action === 'sync') {
        const result = syncKanbanBoard(vaultPath, options);
        console.log(`✓ Synced kanban board: ${result.outputPath}`);
        console.log(`  Grouped by: ${result.groupBy}`);
        console.log(`  Tasks included: ${result.taskCount}`);
        return;
    }
    if (action === 'import') {
        const result = importKanbanBoard(vaultPath, options);
        console.log(`✓ Imported kanban board: ${result.outputPath}`);
        console.log(`  Grouped by: ${result.groupBy}`);
        if (result.changes.length === 0) {
            console.log('  No task updates required.');
        }
        else {
            console.log(`  Updated ${result.changes.length} task field(s):`);
            for (const change of result.changes) {
                const from = change.from ?? '(unset)';
                const to = change.to ?? '(unset)';
                console.log(`  - ${change.slug}: ${change.field} ${from} -> ${to}`);
            }
        }
        if (result.missingSlugs.length > 0) {
            console.log(`  Missing tasks (${result.missingSlugs.length}): ${result.missingSlugs.join(', ')}`);
        }
        return;
    }
    throw new Error(`Unknown kanban action: ${action}`);
}
//# sourceMappingURL=kanban.js.map