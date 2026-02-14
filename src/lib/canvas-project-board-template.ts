/**
 * Project Board Canvas Template
 * Owner-centric task management dashboard for agents and humans.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────────┐
 * │  📋 PROJECT BOARD — All Projects · N tasks                   │
 * ├──────────────┬──────────────┬──────────────┬────────────────┤
 * │  ⚪ OPEN     │  🔨 ACTIVE   │  🔴 BLOCKED  │  ✅ DONE       │
 * │              │              │              │                │
 * │  @owner      │  @owner      │  blocked_by  │  completed     │
 * │  task card   │  task card   │  task card   │  task card     │
 * │  task card   │  task card   │              │  task card     │
 * ├──────────────┴──────────────┴──────────────┴────────────────┤
 * │  📊 BY OWNER                │  📋 BACKLOG                    │
 * │  ┌─────────┐ ┌─────────┐   │  ┌─────────────────────────┐  │
 * │  │@agent1  │ │@human1  │   │  │ backlog items            │  │
 * │  │ 3 tasks │ │ 2 tasks │   │  │ grouped by project       │  │
 * │  └─────────┘ └─────────┘   │  └─────────────────────────┘  │
 * └──────────────────────────────────────────────────────────────┘
 */

import * as path from 'path';
import {
  listTasks,
  listBacklogItems,
  getActiveTasks,
  getBlockedTasks,
  getRecentlyCompletedTasks,
  type Task,
  type TaskStatus,
  type BacklogItem
} from './task-utils.js';
import {
  type Canvas,
  type CanvasNode,
  type CanvasEdge,
  createTextNode,
  createFileNode,
  createGroupNode,
  createGroupWithNodes,
  createEdge,
  flattenGroups,
  getPriorityColor,
  truncateText,
  CANVAS_COLORS,
  LAYOUT,
  type GroupWithNodes
} from './canvas-layout.js';
import type { CanvasTemplate, CanvasTemplateOptions } from './canvas-templates.js';

const BOARD = {
  TOTAL_WIDTH: 1400,
  COLUMN_COUNT: 4,
  COLUMN_GAP: 20,
  CARD_HEIGHT: 70,
  CARD_GAP: 10,
  OWNER_SECTION_Y_OFFSET: 40,
  MAX_TASKS_PER_COLUMN: 12,
  MAX_DONE_TASKS: 8,
  OWNER_CARD_WIDTH: 200,
  OWNER_CARD_HEIGHT: 120,
  OWNER_GAP: 15,
  BACKLOG_WIDTH: 600,
} as const;

interface TaskCard {
  task: Task;
  displayText: string;
  color?: string;
}

function buildTaskCard(task: Task): TaskCard {
  const ownerTag = task.frontmatter.owner ? `@${task.frontmatter.owner}` : 'unassigned';
  const priorityIcon = task.frontmatter.priority === 'critical' ? '🔴 ' :
    task.frontmatter.priority === 'high' ? '🟠 ' :
    task.frontmatter.priority === 'medium' ? '🟡 ' : '';
  const projectTag = task.frontmatter.project ? ` · ${task.frontmatter.project}` : '';
  const dueTag = task.frontmatter.due ? `\n📅 ${task.frontmatter.due}` : '';

  return {
    task,
    displayText: `${priorityIcon}**${truncateText(task.title, 35)}**\n${ownerTag}${projectTag}${dueTag}`,
    color: getPriorityColor(task.frontmatter.priority)
  };
}

function getColumnWidth(): number {
  return Math.floor((BOARD.TOTAL_WIDTH - BOARD.COLUMN_GAP * (BOARD.COLUMN_COUNT - 1)) / BOARD.COLUMN_COUNT);
}

function buildStatusColumn(
  x: number,
  y: number,
  width: number,
  label: string,
  tasks: Task[],
  groupColor?: string,
  maxTasks?: number
): { nodes: CanvasNode[]; height: number } {
  const nodes: CanvasNode[] = [];
  const max = maxTasks ?? BOARD.MAX_TASKS_PER_COLUMN;
  const displayTasks = tasks.slice(0, max);

  // Task cards
  let cardY = y + 50; // space for group header
  for (const task of displayTasks) {
    const card = buildTaskCard(task);
    nodes.push(createTextNode(
      x + 10, cardY,
      width - 20, BOARD.CARD_HEIGHT,
      card.displayText,
      card.color || (task.frontmatter.status === 'blocked' ? CANVAS_COLORS.RED : undefined)
    ));
    cardY += BOARD.CARD_HEIGHT + BOARD.CARD_GAP;
  }

  if (tasks.length === 0) {
    nodes.push(createTextNode(x + 10, cardY, width - 20, 40, '_Empty_'));
    cardY += 50;
  }

  if (tasks.length > max) {
    nodes.push(createTextNode(
      x + 10, cardY, width - 20, 35,
      `_+${tasks.length - max} more_`
    ));
    cardY += 45;
  }

  const groupHeight = cardY - y + 15;
  const group = createGroupNode(x, y, width, groupHeight, `${label} (${tasks.length})`, groupColor);
  nodes.unshift(group);

  return { nodes, height: groupHeight };
}

function buildOwnerSection(
  tasks: Task[],
  startX: number,
  startY: number,
  sectionWidth: number
): CanvasNode[] {
  const nodes: CanvasNode[] = [];

  // Group tasks by owner
  const byOwner = new Map<string, Task[]>();
  for (const task of tasks) {
    const owner = task.frontmatter.owner || 'unassigned';
    const bucket = byOwner.get(owner) || [];
    bucket.push(task);
    byOwner.set(owner, bucket);
  }

  const owners = [...byOwner.entries()]
    .sort((a, b) => b[1].length - a[1].length);

  // Owner summary group
  const ownerGroupWidth = sectionWidth;
  const cardsPerRow = Math.max(1, Math.floor((ownerGroupWidth - 40) / (BOARD.OWNER_CARD_WIDTH + BOARD.OWNER_GAP)));

  let cardX = startX + 20;
  let cardY = startY + 50;
  let maxRowHeight = 0;

  for (let i = 0; i < owners.length; i++) {
    const [owner, ownerTasks] = owners[i];
    const statusCounts = {
      open: ownerTasks.filter(t => t.frontmatter.status === 'open').length,
      active: ownerTasks.filter(t => t.frontmatter.status === 'in-progress').length,
      blocked: ownerTasks.filter(t => t.frontmatter.status === 'blocked').length,
      done: ownerTasks.filter(t => t.frontmatter.status === 'done').length,
    };

    const isAgent = owner !== 'unassigned' && !owner.includes(' '); // heuristic: agents don't have spaces
    const icon = isAgent ? '🤖' : '👤';
    const statusLine = [
      statusCounts.active > 0 ? `🔨${statusCounts.active}` : '',
      statusCounts.open > 0 ? `⚪${statusCounts.open}` : '',
      statusCounts.blocked > 0 ? `🔴${statusCounts.blocked}` : '',
      statusCounts.done > 0 ? `✅${statusCounts.done}` : '',
    ].filter(Boolean).join(' ');

    const topTask = ownerTasks.find(t => t.frontmatter.status === 'in-progress') ||
      ownerTasks.find(t => t.frontmatter.status === 'open');
    const focusLine = topTask ? `\n→ ${truncateText(topTask.title, 22)}` : '';

    const card = createTextNode(
      cardX, cardY,
      BOARD.OWNER_CARD_WIDTH, BOARD.OWNER_CARD_HEIGHT,
      `${icon} **@${owner}**\n${statusLine}${focusLine}`,
      statusCounts.blocked > 0 ? CANVAS_COLORS.RED :
        statusCounts.active > 0 ? CANVAS_COLORS.CYAN : undefined
    );
    nodes.push(card);

    maxRowHeight = Math.max(maxRowHeight, BOARD.OWNER_CARD_HEIGHT);
    cardX += BOARD.OWNER_CARD_WIDTH + BOARD.OWNER_GAP;

    if ((i + 1) % cardsPerRow === 0) {
      cardX = startX + 20;
      cardY += maxRowHeight + BOARD.OWNER_GAP;
      maxRowHeight = 0;
    }
  }

  if (owners.length === 0) {
    nodes.push(createTextNode(startX + 20, cardY, 300, 40, '_No tasks assigned to any owner_'));
    cardY += 50;
  }

  const totalHeight = cardY + maxRowHeight + 30 - startY;
  const group = createGroupNode(
    startX, startY, ownerGroupWidth, totalHeight,
    `👥 BY OWNER (${owners.length} owners · ${tasks.length} tasks)`
  );
  nodes.unshift(group);

  return nodes;
}

function buildBacklogSection(
  vaultPath: string,
  startX: number,
  startY: number,
  width: number,
  project?: string
): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const backlog = listBacklogItems(vaultPath);
  const filtered = project
    ? backlog.filter(i => i.frontmatter.project === project)
    : backlog;

  let contentY = startY + 50;

  if (filtered.length === 0) {
    nodes.push(createTextNode(startX + 15, contentY, width - 30, 40, '_Backlog empty_'));
    contentY += 50;
  } else {
    // Group by project
    const byProject = new Map<string, BacklogItem[]>();
    for (const item of filtered) {
      const proj = item.frontmatter.project || 'No Project';
      const bucket = byProject.get(proj) || [];
      bucket.push(item);
      byProject.set(proj, bucket);
    }

    for (const [proj, items] of byProject) {
      const itemList = items.slice(0, 5)
        .map(i => `- ${truncateText(i.title, 40)}`)
        .join('\n');
      const more = items.length > 5 ? `\n_+${items.length - 5} more_` : '';

      nodes.push(createTextNode(
        startX + 15, contentY,
        width - 30, 30 + items.slice(0, 5).length * 22,
        `**${proj}** (${items.length})\n${itemList}${more}`
      ));
      contentY += 40 + Math.min(items.length, 5) * 22 + 10;
    }
  }

  const groupHeight = contentY - startY + 15;
  const group = createGroupNode(
    startX, startY, width, groupHeight,
    `📋 BACKLOG (${filtered.length})`,
    CANVAS_COLORS.YELLOW
  );
  nodes.unshift(group);

  return nodes;
}

export function generateProjectBoardCanvas(
  vaultPath: string,
  options: CanvasTemplateOptions = {}
): Canvas {
  const resolvedPath = path.resolve(vaultPath);
  const filter: Record<string, string> = {};
  if (options.project) filter.project = options.project;
  if (options.owner) filter.owner = options.owner;
  const allTasks = listTasks(resolvedPath, Object.keys(filter).length > 0 ? filter : undefined);

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  const colWidth = getColumnWidth();

  // Header
  const filterParts: string[] = [];
  if (options.project) filterParts.push(options.project);
  if (options.owner) filterParts.push(`@${options.owner}`);
  const filterLabel = filterParts.length > 0 ? filterParts.join(' · ') : 'All Projects';
  const headerText = `**📋 PROJECT BOARD** — ${filterLabel} · ${allTasks.length} tasks`;

  nodes.push(createTextNode(
    0, -60,
    BOARD.TOTAL_WIDTH, 45,
    headerText,
    CANVAS_COLORS.CYAN
  ));

  // Status columns
  const openTasks = allTasks.filter(t => t.frontmatter.status === 'open');
  const activeTasks = allTasks.filter(t => t.frontmatter.status === 'in-progress');
  const blockedTasks = allTasks.filter(t => t.frontmatter.status === 'blocked');
  const doneTasks = allTasks.filter(t => t.frontmatter.status === 'done')
    .sort((a, b) => (b.frontmatter.completed || '').localeCompare(a.frontmatter.completed || ''));

  const columns = [
    { label: '⚪ Open', tasks: openTasks, color: undefined },
    { label: '🔨 In Progress', tasks: activeTasks, color: CANVAS_COLORS.CYAN },
    { label: '🔴 Blocked', tasks: blockedTasks, color: CANVAS_COLORS.RED },
    { label: '✅ Done', tasks: doneTasks, color: CANVAS_COLORS.GREEN, max: BOARD.MAX_DONE_TASKS },
  ];

  let maxColumnHeight = 0;
  const columnData: Array<{ nodes: CanvasNode[]; height: number }> = [];

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const x = i * (colWidth + BOARD.COLUMN_GAP);
    const result = buildStatusColumn(x, 0, colWidth, col.label, col.tasks, col.color, col.max);
    columnData.push(result);
    nodes.push(...result.nodes);
    maxColumnHeight = Math.max(maxColumnHeight, result.height);
  }

  // Blocked-by edges
  const taskNodeMap = new Map<string, string>(); // slug -> node id
  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      for (const task of allTasks) {
        if (node.text.includes(truncateText(task.title, 35))) {
          taskNodeMap.set(task.slug, node.id);
        }
      }
    }
  }
  for (const task of blockedTasks) {
    if (!task.frontmatter.blocked_by) continue;
    const blockerSlug = task.frontmatter.blocked_by.toLowerCase().replace(/[^\w-]/g, '-');
    const blockedNodeId = taskNodeMap.get(task.slug);
    const blockerNodeId = taskNodeMap.get(blockerSlug);
    if (blockedNodeId && blockerNodeId) {
      edges.push(createEdge(blockedNodeId, 'left', blockerNodeId, 'right', 'blocked by', CANVAS_COLORS.RED));
    }
  }

  // Bottom row: Owner summary + Backlog
  const bottomY = maxColumnHeight + 40;
  const ownerWidth = BOARD.TOTAL_WIDTH - BOARD.BACKLOG_WIDTH - BOARD.COLUMN_GAP;

  // Owner section
  const nonDoneTasks = allTasks.filter(t => t.frontmatter.status !== 'done');
  nodes.push(...buildOwnerSection(nonDoneTasks, 0, bottomY, ownerWidth));

  // Backlog section
  nodes.push(...buildBacklogSection(
    resolvedPath,
    ownerWidth + BOARD.COLUMN_GAP,
    bottomY,
    BOARD.BACKLOG_WIDTH,
    options.project
  ));

  return { nodes, edges };
}

export const projectBoardCanvasTemplate: CanvasTemplate = {
  id: 'project-board',
  name: 'Project Board',
  description: 'Owner-centric task management dashboard with status columns, owner cards, and backlog.',
  generate(vaultPath: string, options: CanvasTemplateOptions): Canvas {
    return generateProjectBoardCanvas(vaultPath, options);
  }
};
