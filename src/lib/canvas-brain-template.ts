/**
 * Brain Architecture Canvas Template
 * Neural-inspired system overview: vault structure, content flow,
 * agent workspace, knowledge graph summary, and directory map.
 *
 * Layout (inspired by Neural screenshot):
 * ┌─────────────────────────────────────────────────────────────┐
 * │  🧠 HIPPOCAMPUS — Knowledge Vault    │  📊 DIRECTION       │
 * │  ┌─────────────────────────────────┐  │  Recent decisions   │
 * │  │ Vault name — N Clean Folders    │  │  Open loops         │
 * │  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐   │  │  Priorities         │
 * │  │ │cat │ │cat │ │cat │ │cat │   │  │                     │
 * │  │ └────┘ └────┘ └────┘ └────┘   │  └─────────────────────┘
 * │  └─────────────────────────────────┘  │
 * │  🔄 Content Flow                      │
 * │  Session → Observe → Route → Store    │
 * ├───────────────────────┬───────────────┤
 * │  🤖 AGENT WORKSPACE   │ 📈 GRAPH      │
 * │  Active tasks          │ Nodes/Edges   │
 * │  Blocked items         │ Top entities  │
 * │  Backlog               │ Categories    │
 * └───────────────────────┴───────────────┘
 */

import * as fs from 'fs';
import * as path from 'path';
import { collectVaultStats, type VaultStats } from './vault-stats.js';
import { loadMemoryGraphIndex, type MemoryGraph, type MemoryGraphNode } from './memory-graph.js';
import {
  getActiveTasks,
  getBlockedTasks,
  listBacklogItems,
  type Task,
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
  truncateText,
  CANVAS_COLORS,
  LAYOUT,
  type GroupWithNodes
} from './canvas-layout.js';
import type { CanvasTemplate, CanvasTemplateOptions } from './canvas-templates.js';

// Layout constants for the brain architecture
const BRAIN = {
  TOTAL_WIDTH: 1600,
  TOP_ROW_HEIGHT: 520,
  BOTTOM_ROW_HEIGHT: 480,
  GAP: 30,
  HIPPOCAMPUS_WIDTH: 1050,
  DIRECTION_WIDTH: 500,
  AGENT_WIDTH: 800,
  GRAPH_WIDTH: 770,
  CATEGORY_CARD_WIDTH: 220,
  CATEGORY_CARD_HEIGHT: 90,
  CATEGORY_COLS: 4,
  CATEGORY_ROWS: 3,
  CATEGORY_GAP: 15,
  FLOW_NODE_WIDTH: 130,
  FLOW_NODE_HEIGHT: 45,
  FLOW_GAP: 20,
} as const;

interface CategoryInfo {
  name: string;
  fileCount: number;
  topFiles: string[];
}

function getVaultCategories(vaultPath: string, graph?: MemoryGraph): CategoryInfo[] {
  const categoryMap = new Map<string, { count: number; files: string[] }>();

  if (graph) {
    for (const node of graph.nodes) {
      if (!node.path || node.type === 'tag' || node.type === 'unresolved') continue;
      const folder = node.path.split('/')[0]?.toLowerCase() || 'root';
      const entry = categoryMap.get(folder) || { count: 0, files: [] };
      entry.count++;
      if (entry.files.length < 3) entry.files.push(node.title || node.path);
      categoryMap.set(folder, entry);
    }
  } else {
    const stats = collectVaultStats(vaultPath);
    for (const [cat, count] of Object.entries(stats.documents.byCategory)) {
      categoryMap.set(cat, { count, files: [] });
    }
  }

  return [...categoryMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([name, info]) => ({
      name,
      fileCount: info.count,
      topFiles: info.files
    }));
}

function buildHippocampusGroup(
  vaultPath: string,
  vaultName: string,
  stats: VaultStats,
  graph?: MemoryGraph
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const x = 0;
  const y = 0;

  // Outer group
  const outerGroup = createGroupNode(
    x, y, BRAIN.HIPPOCAMPUS_WIDTH, BRAIN.TOP_ROW_HEIGHT,
    '🧠 HIPPOCAMPUS — Knowledge Vault',
    CANVAS_COLORS.GREEN
  );
  nodes.push(outerGroup);

  // Vault name header
  const categories = getVaultCategories(vaultPath, graph);
  const folderCount = categories.length;
  const totalFiles = graph?.stats.nodeCount ?? stats.documents.total;
  const headerNode = createTextNode(
    x + 20, y + 50,
    BRAIN.HIPPOCAMPUS_WIDTH - 40, 50,
    `**${vaultName}** — ${folderCount} Clean Folders · ${totalFiles} files · ${graph?.stats.edgeCount ?? 0} links`,
    CANVAS_COLORS.CYAN
  );
  nodes.push(headerNode);

  // Category cards in a grid
  const gridStartX = x + 25;
  const gridStartY = y + 120;

  for (let i = 0; i < categories.length && i < BRAIN.CATEGORY_COLS * BRAIN.CATEGORY_ROWS; i++) {
    const cat = categories[i];
    const col = i % BRAIN.CATEGORY_COLS;
    const row = Math.floor(i / BRAIN.CATEGORY_COLS);
    const cx = gridStartX + col * (BRAIN.CATEGORY_CARD_WIDTH + BRAIN.CATEGORY_GAP);
    const cy = gridStartY + row * (BRAIN.CATEGORY_CARD_HEIGHT + BRAIN.CATEGORY_GAP);

    const filesPreview = cat.topFiles.length > 0
      ? cat.topFiles.map(f => truncateText(f, 25)).join(', ')
      : `${cat.fileCount} files`;

    const cardNode = createTextNode(
      cx, cy,
      BRAIN.CATEGORY_CARD_WIDTH, BRAIN.CATEGORY_CARD_HEIGHT,
      `**${cat.name}/**\n${filesPreview}\n_${cat.fileCount} files_`
    );
    nodes.push(cardNode);
  }

  // Content Flow at the bottom of hippocampus
  const flowY = y + BRAIN.TOP_ROW_HEIGHT - 80;
  const flowLabel = createTextNode(
    x + 20, flowY - 5,
    160, 30,
    '**🔄 Content Flow**'
  );
  nodes.push(flowLabel);

  const flowSteps = ['Session', 'Observe', 'Score', 'Route', 'Store', 'Reflect'];
  const flowStartX = x + 200;
  const flowNodes: CanvasNode[] = [];

  for (let i = 0; i < flowSteps.length; i++) {
    const stepNode = createTextNode(
      flowStartX + i * (BRAIN.FLOW_NODE_WIDTH + BRAIN.FLOW_GAP),
      flowY,
      BRAIN.FLOW_NODE_WIDTH,
      BRAIN.FLOW_NODE_HEIGHT,
      `**${flowSteps[i]}**`,
      i === 0 ? CANVAS_COLORS.CYAN : i === flowSteps.length - 1 ? CANVAS_COLORS.PURPLE : undefined
    );
    flowNodes.push(stepNode);
    nodes.push(stepNode);
  }

  for (let i = 0; i < flowNodes.length - 1; i++) {
    edges.push(createEdge(flowNodes[i].id, 'right', flowNodes[i + 1].id, 'left', '→'));
  }

  return { nodes, edges };
}

function buildDirectionGroup(
  vaultPath: string,
  stats: VaultStats,
  graph?: MemoryGraph
): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const x = BRAIN.HIPPOCAMPUS_WIDTH + BRAIN.GAP;
  const y = 0;

  // Direction group
  const group = createGroupNode(
    x, y, BRAIN.DIRECTION_WIDTH, BRAIN.TOP_ROW_HEIGHT,
    '📊 DIRECTION',
    CANVAS_COLORS.ORANGE
  );
  nodes.push(group);

  // Stats summary
  const statsText = [
    '**Vault Overview**',
    '',
    `Files: ${graph?.stats.nodeCount ?? stats.documents.total}`,
    `Wiki links: ${graph?.stats.edgeCount ?? 0}`,
    `Tasks: ${stats.tasks.total} (${stats.tasks.open} open, ${stats.tasks.blocked} blocked)`,
    `Observations: ${stats.observations.total}`,
    `Completion: ${stats.tasks.completionRate}%`,
  ].join('\n');

  nodes.push(createTextNode(
    x + 20, y + 50,
    BRAIN.DIRECTION_WIDTH - 40, 160,
    statsText,
    CANVAS_COLORS.CYAN
  ));

  // Recent decisions
  const decisionsDir = path.join(vaultPath, 'decisions');
  let decisionsText = '**Recent Decisions**\n';
  if (fs.existsSync(decisionsDir)) {
    const files = fs.readdirSync(decisionsDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 6);
    decisionsText += files.length > 0
      ? files.map(f => `- ${truncateText(f.replace('.md', ''), 35)}`).join('\n')
      : '_No decisions recorded_';
  } else {
    decisionsText += '_No decisions folder_';
  }

  nodes.push(createTextNode(
    x + 20, y + 230,
    BRAIN.DIRECTION_WIDTH - 40, 140,
    decisionsText
  ));

  // Open loops / priorities
  const openLoops = [
    `Open tasks: ${stats.tasks.open}`,
    `Blocked: ${stats.tasks.blocked}`,
    `Backlog items: ${stats.tasks.total > 0 ? 'see agent workspace' : '0'}`,
    stats.observations.latestDate ? `Last observation: ${stats.observations.latestDate}` : '',
  ].filter(Boolean);

  nodes.push(createTextNode(
    x + 20, y + 390,
    BRAIN.DIRECTION_WIDTH - 40, 110,
    '**Open Loops**\n' + openLoops.map(l => `- ${l}`).join('\n')
  ));

  return nodes;
}

function buildAgentWorkspaceGroup(
  vaultPath: string
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const x = 0;
  const y = BRAIN.TOP_ROW_HEIGHT + BRAIN.GAP;

  const group = createGroupNode(
    x, y, BRAIN.AGENT_WIDTH, BRAIN.BOTTOM_ROW_HEIGHT,
    '🤖 AGENT WORKSPACE — Tasks & Actionables',
    CANVAS_COLORS.CYAN
  );
  nodes.push(group);

  const activeTasks = getActiveTasks(vaultPath);
  const blockedTasks = getBlockedTasks(vaultPath);
  const backlog = listBacklogItems(vaultPath);

  const colWidth = (BRAIN.AGENT_WIDTH - 80) / 3;
  const colY = y + 55;
  const innerHeight = BRAIN.BOTTOM_ROW_HEIGHT - 80;

  // Active tasks column
  const activeGroup = createGroupNode(
    x + 20, colY, colWidth, innerHeight,
    `● Active (${activeTasks.length})`,
    CANVAS_COLORS.GREEN
  );
  nodes.push(activeGroup);

  let activeY = colY + 50;
  for (const task of activeTasks.slice(0, 8)) {
    const ownerTag = task.frontmatter.owner ? ` @${task.frontmatter.owner}` : '';
    const priorityTag = task.frontmatter.priority === 'critical' ? ' 🔴' :
      task.frontmatter.priority === 'high' ? ' 🟠' : '';
    const node = createTextNode(
      x + 30, activeY,
      colWidth - 20, 55,
      `**${truncateText(task.title, 30)}**${priorityTag}\n${task.frontmatter.project || ''}${ownerTag}`
    );
    nodes.push(node);
    activeY += 65;
  }
  if (activeTasks.length === 0) {
    nodes.push(createTextNode(x + 30, activeY, colWidth - 20, 40, '_No active tasks_'));
  }

  // Blocked tasks column
  const blockedGroup = createGroupNode(
    x + 20 + colWidth + 10, colY, colWidth, innerHeight,
    `■ Blocked (${blockedTasks.length})`,
    CANVAS_COLORS.RED
  );
  nodes.push(blockedGroup);

  let blockedY = colY + 50;
  for (const task of blockedTasks.slice(0, 8)) {
    const blocker = task.frontmatter.blocked_by || 'unknown';
    const node = createTextNode(
      x + 30 + colWidth + 10, blockedY,
      colWidth - 20, 55,
      `**${truncateText(task.title, 28)}**\n⛔ ${truncateText(blocker, 25)}`,
      CANVAS_COLORS.RED
    );
    nodes.push(node);
    blockedY += 65;

    // Edge from blocked to active if blocker exists
    const blockerTask = activeTasks.find(t =>
      t.slug === blocker.toLowerCase().replace(/[^\w-]/g, '-')
    );
    if (blockerTask) {
      const blockerNode = nodes.find(n =>
        n.text?.includes(truncateText(blockerTask.title, 30))
      );
      if (blockerNode) {
        edges.push(createEdge(node.id, 'left', blockerNode.id, 'right', 'blocked by', CANVAS_COLORS.RED));
      }
    }
  }
  if (blockedTasks.length === 0) {
    nodes.push(createTextNode(x + 30 + colWidth + 10, blockedY, colWidth - 20, 40, '_None blocked_ ✅'));
  }

  // Backlog column
  const backlogGroup = createGroupNode(
    x + 20 + (colWidth + 10) * 2, colY, colWidth, innerHeight,
    `📋 Backlog (${backlog.length})`
  );
  nodes.push(backlogGroup);

  let backlogY = colY + 50;
  for (const item of backlog.slice(0, 8)) {
    const src = item.frontmatter.source ? ` (${item.frontmatter.source})` : '';
    const node = createTextNode(
      x + 30 + (colWidth + 10) * 2, backlogY,
      colWidth - 20, 55,
      `**${truncateText(item.title, 30)}**\n${item.frontmatter.project || ''}${src}`
    );
    nodes.push(node);
    backlogY += 65;
  }
  if (backlog.length === 0) {
    nodes.push(createTextNode(x + 30 + (colWidth + 10) * 2, backlogY, colWidth - 20, 40, '_Backlog empty_'));
  }

  return { nodes, edges };
}

function buildGraphSummaryGroup(
  vaultPath: string,
  graph?: MemoryGraph
): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const x = BRAIN.AGENT_WIDTH + BRAIN.GAP;
  const y = BRAIN.TOP_ROW_HEIGHT + BRAIN.GAP;

  const group = createGroupNode(
    x, y, BRAIN.GRAPH_WIDTH, BRAIN.BOTTOM_ROW_HEIGHT,
    '📈 KNOWLEDGE GRAPH',
    CANVAS_COLORS.PURPLE
  );
  nodes.push(group);

  if (!graph) {
    nodes.push(createTextNode(
      x + 20, y + 55,
      BRAIN.GRAPH_WIDTH - 40, 60,
      '_Run `clawvault graph build` to generate the knowledge graph._'
    ));
    return nodes;
  }

  // Graph stats
  const statsText = [
    '**Graph Stats**',
    '',
    `Nodes: ${graph.stats.nodeCount}`,
    `Edges: ${graph.stats.edgeCount}`,
    `File nodes: ${Object.entries(graph.stats.nodeTypeCounts).filter(([t]) => t !== 'tag' && t !== 'unresolved').reduce((s, [, c]) => s + c, 0)}`,
    `Tags: ${graph.stats.nodeTypeCounts['tag'] || 0}`,
    `Unresolved: ${graph.stats.nodeTypeCounts['unresolved'] || 0}`,
  ].join('\n');

  nodes.push(createTextNode(
    x + 20, y + 55,
    (BRAIN.GRAPH_WIDTH - 50) / 2, 170,
    statsText,
    CANVAS_COLORS.CYAN
  ));

  // Top entities by connectivity
  const topEntities = graph.nodes
    .filter(n => n.type !== 'tag' && n.type !== 'unresolved')
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 12);

  const entitiesText = '**Most Connected**\n\n' +
    topEntities.map(e => `- ${truncateText(e.title, 28)} (${e.degree})`).join('\n');

  nodes.push(createTextNode(
    x + 20 + (BRAIN.GRAPH_WIDTH - 50) / 2 + 10, y + 55,
    (BRAIN.GRAPH_WIDTH - 50) / 2, 170,
    entitiesText
  ));

  // Category breakdown
  const typeCounts = Object.entries(graph.stats.nodeTypeCounts)
    .filter(([t]) => t !== 'tag' && t !== 'unresolved')
    .sort((a, b) => b[1] - a[1]);

  const categoryBars = typeCounts.map(([type, count]) => {
    const maxBar = 20;
    const barLen = Math.max(1, Math.round((count / (typeCounts[0]?.[1] || 1)) * maxBar));
    const bar = '█'.repeat(barLen);
    return `${type.padEnd(14)} ${bar} ${count}`;
  }).join('\n');

  nodes.push(createTextNode(
    x + 20, y + 245,
    BRAIN.GRAPH_WIDTH - 40, 200,
    `**Categories**\n\`\`\`\n${categoryBars}\n\`\`\``,
    CANVAS_COLORS.PURPLE
  ));

  return nodes;
}

export function generateBrainCanvas(
  vaultPath: string,
  options: CanvasTemplateOptions = {}
): Canvas {
  const resolvedPath = path.resolve(vaultPath);
  const graphIndex = loadMemoryGraphIndex(resolvedPath);
  const graph = graphIndex?.graph;
  const stats = collectVaultStats(resolvedPath);
  const vaultName = path.basename(resolvedPath);

  const allNodes: CanvasNode[] = [];
  const allEdges: CanvasEdge[] = [];

  // Top-left: Hippocampus (vault structure + content flow)
  const hippo = buildHippocampusGroup(resolvedPath, vaultName, stats, graph);
  allNodes.push(...hippo.nodes);
  allEdges.push(...hippo.edges);

  // Top-right: Direction (stats, decisions, open loops)
  allNodes.push(...buildDirectionGroup(resolvedPath, stats, graph));

  // Bottom-left: Agent Workspace (tasks, blocked, backlog)
  const agent = buildAgentWorkspaceGroup(resolvedPath);
  allNodes.push(...agent.nodes);
  allEdges.push(...agent.edges);

  // Bottom-right: Knowledge Graph summary
  allNodes.push(...buildGraphSummaryGroup(resolvedPath, graph));

  return { nodes: allNodes, edges: allEdges };
}

export const brainCanvasTemplate: CanvasTemplate = {
  id: 'brain',
  name: 'Brain Architecture',
  description: 'Neural-inspired system overview: vault structure, content flow, agent workspace, and knowledge graph.',
  generate(vaultPath: string, options: CanvasTemplateOptions): Canvas {
    return generateBrainCanvas(vaultPath, options);
  }
};
