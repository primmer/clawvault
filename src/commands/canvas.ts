/**
 * Canvas command for ClawVault
 * Generates an Obsidian JSON Canvas dashboard
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  listTasks,
  listBacklogItems,
  getBlockedTasks,
  getActiveTasks,
  getRecentlyCompletedTasks,
  getStatusIcon,
  type Task,
  type BacklogItem
} from '../lib/task-utils.js';
import {
  Canvas,
  CanvasNode,
  CanvasEdge,
  createTextNode,
  createFileNode,
  createGroupNode,
  createGroupWithNodes,
  createEdge,
  positionGroupsVertically,
  flattenGroups,
  getPriorityColor,
  truncateText,
  formatCanvasText,
  CANVAS_COLORS,
  LAYOUT,
  type GroupWithNodes
} from '../lib/canvas-layout.js';
import { loadMemoryGraphIndex, type MemoryGraph } from '../lib/memory-graph.js';
import { readObservations } from '../lib/observation-reader.js';
import { listObservationFiles, getReflectionsRoot } from '../lib/ledger.js';
import {
  collectVaultStats,
  formatDateRange,
  formatTaskStatusLine,
  type VaultStats
} from '../lib/vault-stats.js';

export interface CanvasOptions {
  output?: string;
}

/**
 * Generate the canvas dashboard
 */
export function generateCanvas(vaultPath: string): Canvas {
  const resolvedPath = path.resolve(vaultPath);
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  // Gather data
  const activeTasks = getActiveTasks(resolvedPath);
  const blockedTasks = getBlockedTasks(resolvedPath);
  const backlogItems = listBacklogItems(resolvedPath);
  const recentlyDone = getRecentlyCompletedTasks(resolvedPath, 10);
  const graphIndex = loadMemoryGraphIndex(resolvedPath);
  
  // Build left column groups
  const leftGroups: GroupWithNodes[] = [];
  
  // Knowledge Graph group
  const knowledgeGraphGroup = buildKnowledgeGraphGroup(resolvedPath, graphIndex?.graph);
  leftGroups.push(knowledgeGraphGroup);
  
  // Vault Stats group
  const vaultStatsGroup = buildVaultStatsGroup(resolvedPath, graphIndex?.graph);
  leftGroups.push(vaultStatsGroup);

  // Vault Activity group
  const vaultActivityGroup = buildVaultActivityGroup(resolvedPath);
  leftGroups.push(vaultActivityGroup);

  // Build right column groups
  const rightGroups: GroupWithNodes[] = [];
  
  // Active Tasks group
  if (activeTasks.length > 0) {
    const activeTasksGroup = buildActiveTasksGroup(activeTasks);
    rightGroups.push(activeTasksGroup);
  }
  
  // Blocked Tasks group
  if (blockedTasks.length > 0) {
    const blockedTasksGroup = buildBlockedTasksGroup(blockedTasks);
    rightGroups.push(blockedTasksGroup);
  }
  
  // Backlog group
  if (backlogItems.length > 0) {
    const backlogGroup = buildBacklogGroup(backlogItems);
    rightGroups.push(backlogGroup);
  }
  
  // Recently Done group
  if (recentlyDone.length > 0) {
    const recentlyDoneGroup = buildRecentlyDoneGroup(recentlyDone);
    rightGroups.push(recentlyDoneGroup);
  }

  // Position groups
  const positionedLeft = positionGroupsVertically(leftGroups, 0);
  const positionedRight = positionGroupsVertically(rightGroups, 0);

  // Add all nodes
  nodes.push(...flattenGroups(positionedLeft));
  nodes.push(...flattenGroups(positionedRight));

  // Add data flow diagram at bottom
  const maxLeftHeight = positionedLeft.length > 0 
    ? positionedLeft[positionedLeft.length - 1].group.y + positionedLeft[positionedLeft.length - 1].group.height
    : 0;
  const maxRightHeight = positionedRight.length > 0
    ? positionedRight[positionedRight.length - 1].group.y + positionedRight[positionedRight.length - 1].group.height
    : 0;
  const bottomY = Math.max(maxLeftHeight, maxRightHeight) + LAYOUT.GROUP_SPACING;

  const dataFlowResult = buildDataFlowDiagram(bottomY);
  nodes.push(...dataFlowResult.nodes);
  edges.push(...dataFlowResult.edges);

  // Add edges for blocked tasks to their blockers (if they exist as tasks)
  const taskSlugs = new Set(listTasks(resolvedPath).map(t => t.slug));
  for (const task of blockedTasks) {
    if (task.frontmatter.blocked_by) {
      const blockerSlug = task.frontmatter.blocked_by
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-');
      
      if (taskSlugs.has(blockerSlug)) {
        // Find the nodes for these tasks
        const taskNode = nodes.find(n => n.type === 'file' && n.file === `tasks/${task.slug}.md`);
        const blockerNode = nodes.find(n => n.type === 'file' && n.file === `tasks/${blockerSlug}.md`);
        
        if (taskNode && blockerNode) {
          edges.push(createEdge(taskNode.id, 'left', blockerNode.id, 'right', 'blocked by', CANVAS_COLORS.RED));
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * Build the Knowledge Graph group
 */
function buildKnowledgeGraphGroup(vaultPath: string, graph?: MemoryGraph): GroupWithNodes {
  const childNodes: CanvasNode[] = [];
  
  // Stats text node
  let statsText = '**Knowledge Graph**\n\n';
  if (graph) {
    statsText += `Nodes: ${graph.stats.nodeCount}\n`;
    statsText += `Edges: ${graph.stats.edgeCount}\n`;
    statsText += `Files: ${Object.keys(graph.stats.nodeTypeCounts).filter(t => t !== 'tag' && t !== 'unresolved').reduce((sum, t) => sum + (graph.stats.nodeTypeCounts[t] || 0), 0)}\n`;
  } else {
    statsText += 'Graph not available\n';
  }
  
  childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.DEFAULT_NODE_HEIGHT, statsText));
  
  // Top entities (by degree)
  if (graph && graph.nodes.length > 0) {
    const topEntities = graph.nodes
      .filter(n => n.type !== 'tag' && n.type !== 'unresolved')
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 10);
    
    if (topEntities.length > 0) {
      const entitiesText = '**Top Entities**\n\n' + topEntities.map(e => `- ${e.title} (${e.degree})`).join('\n');
      childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.DEFAULT_NODE_HEIGHT + 40, entitiesText));
    }
  }
  
  // Recent decisions
  const decisionsDir = path.join(vaultPath, 'decisions');
  if (fs.existsSync(decisionsDir)) {
    const decisionFiles = fs.readdirSync(decisionsDir)
      .filter(f => f.endsWith('.md'))
      .slice(0, 5);
    
    if (decisionFiles.length > 0) {
      const decisionsText = '**Recent Decisions**\n\n' + decisionFiles.map(f => `- ${f.replace('.md', '')}`).join('\n');
      childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.DEFAULT_NODE_HEIGHT, decisionsText));
    }
  }

  return createGroupWithNodes(
    LAYOUT.LEFT_COLUMN_X,
    0,
    LAYOUT.LEFT_COLUMN_WIDTH,
    '🧠 Knowledge Graph',
    childNodes,
    CANVAS_COLORS.PURPLE
  );
}

/**
 * Build the Vault Stats group
 */
function buildVaultStatsGroup(vaultPath: string, graph?: MemoryGraph): GroupWithNodes {
  const childNodes: CanvasNode[] = [];
  
  // Category breakdown
  let categoryText = '**Categories**\n\n';
  if (graph) {
    const typeCounts = graph.stats.nodeTypeCounts;
    const categories = Object.entries(typeCounts)
      .filter(([type]) => type !== 'tag' && type !== 'unresolved')
      .sort((a, b) => b[1] - a[1]);
    
    for (const [type, count] of categories) {
      categoryText += `- ${type}: ${count}\n`;
    }
  } else {
    categoryText += 'Stats not available\n';
  }
  
  childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.DEFAULT_NODE_HEIGHT + 20, categoryText));
  
  // Recent observations summary
  const observationFiles = listObservationFiles(vaultPath, { includeLegacy: true, includeArchive: false });
  const recentObsCount = observationFiles.length;
  
  let obsText = '**Observations**\n\n';
  obsText += `Total days: ${recentObsCount}\n`;
  
  if (recentObsCount > 0) {
    const latestDate = observationFiles[observationFiles.length - 1]?.date || 'N/A';
    obsText += `Latest: ${latestDate}\n`;
  }
  
  childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.SMALL_NODE_HEIGHT + 20, obsText));
  
  // Open loops from latest reflection (if exists)
  const reflectionsRoot = getReflectionsRoot(vaultPath);
  if (fs.existsSync(reflectionsRoot)) {
    // Find latest reflection file
    const reflectionFiles = fs.readdirSync(reflectionsRoot, { recursive: true })
      .filter(f => typeof f === 'string' && f.endsWith('.md'))
      .sort()
      .reverse();
    
    if (reflectionFiles.length > 0) {
      const latestReflection = reflectionFiles[0] as string;
      const reflectionPath = path.join(reflectionsRoot, latestReflection);
      
      try {
        const content = fs.readFileSync(reflectionPath, 'utf-8');
        const openLoopsMatch = content.match(/## Open Loops\n([\s\S]*?)(?=\n##|$)/);
        
        if (openLoopsMatch) {
          const openLoops = openLoopsMatch[1].trim().split('\n').filter(l => l.startsWith('-')).slice(0, 5);
          if (openLoops.length > 0) {
            const loopsText = '**Open Loops**\n\n' + openLoops.join('\n');
            childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.DEFAULT_NODE_HEIGHT, loopsText));
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  return createGroupWithNodes(
    LAYOUT.LEFT_COLUMN_X,
    0,
    LAYOUT.LEFT_COLUMN_WIDTH,
    '📊 Vault Stats',
    childNodes,
    CANVAS_COLORS.CYAN
  );
}

/**
 * Build the Vault Activity group
 * Shows operational stats: observations, reflections, tasks, sessions, documents
 */
function buildVaultActivityGroup(vaultPath: string): GroupWithNodes {
  const childNodes: CanvasNode[] = [];
  const stats = collectVaultStats(vaultPath);

  // Observations section
  let obsText = '**Observations**\n\n';
  obsText += `Total: ${stats.observations.total}`;
  if (stats.observations.firstDate && stats.observations.latestDate) {
    obsText += ` (${formatDateRange(stats.observations.firstDate, stats.observations.latestDate)})`;
  }
  obsText += '\n';
  if (stats.observations.avgPerDay > 0) {
    obsText += `Avg: ${stats.observations.avgPerDay}/day`;
  }
  childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.SMALL_NODE_HEIGHT + 20, obsText));

  // Reflections section
  let reflText = '**Reflections**\n\n';
  reflText += `Total: ${stats.reflections.total}\n`;
  if (stats.reflections.latestDate) {
    reflText += `Latest: ${stats.reflections.latestDate}\n`;
  }
  if (stats.reflections.weeksCovered > 0) {
    reflText += `Weeks covered: ${stats.reflections.weeksCovered}`;
  }
  childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.SMALL_NODE_HEIGHT + 20, reflText));

  // Tasks section
  let tasksText = '**Tasks**\n\n';
  tasksText += `Total: ${stats.tasks.total}\n`;
  const statusLine = formatTaskStatusLine(stats.tasks);
  if (statusLine) {
    tasksText += `${statusLine}\n`;
  }
  if (stats.tasks.total > 0) {
    tasksText += `Completion: ${stats.tasks.completionRate}%`;
  }
  childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.DEFAULT_NODE_HEIGHT, tasksText));

  // Sessions section
  let sessionsText = '**Sessions**\n\n';
  sessionsText += `Checkpoints: ${stats.sessions.checkpoints}\n`;
  sessionsText += `Handoffs: ${stats.sessions.handoffs}`;
  if (stats.sessions.lastCheckpoint) {
    sessionsText += `\nLast checkpoint: ${stats.sessions.lastCheckpoint}`;
  }
  childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.SMALL_NODE_HEIGHT + 20, sessionsText));

  // Documents section
  const categoryCount = Object.keys(stats.documents.byCategory).length;
  let docsText = '**Documents**\n\n';
  docsText += `Total: ${stats.documents.total} across ${categoryCount} categories\n`;
  if (stats.documents.inboxPending > 0) {
    docsText += `Inbox: ${stats.documents.inboxPending} pending triage`;
  }
  childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.SMALL_NODE_HEIGHT + 20, docsText));

  // Ledger section (if has data)
  if (stats.ledger.rawTranscripts > 0 || stats.ledger.totalLedgerSizeMB > 0) {
    let ledgerText = '**Ledger**\n\n';
    ledgerText += `Raw transcripts: ${stats.ledger.rawTranscripts}\n`;
    ledgerText += `Size: ${stats.ledger.totalLedgerSizeMB} MB`;
    childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.SMALL_NODE_HEIGHT + 10, ledgerText));
  }

  return createGroupWithNodes(
    LAYOUT.LEFT_COLUMN_X,
    0,
    LAYOUT.LEFT_COLUMN_WIDTH,
    '📈 Vault Activity',
    childNodes,
    CANVAS_COLORS.CYAN
  );
}

/**
 * Build the Active Tasks group
 */
function buildActiveTasksGroup(tasks: Task[]): GroupWithNodes {
  const childNodes: CanvasNode[] = [];
  
  for (const task of tasks.slice(0, 10)) {
    const color = getPriorityColor(task.frontmatter.priority);
    const relativePath = `tasks/${task.slug}.md`;
    childNodes.push(createFileNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.FILE_NODE_HEIGHT, relativePath, color));
  }
  
  if (tasks.length > 10) {
    childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.SMALL_NODE_HEIGHT, `... and ${tasks.length - 10} more`));
  }

  return createGroupWithNodes(
    LAYOUT.RIGHT_COLUMN_X,
    0,
    LAYOUT.RIGHT_COLUMN_WIDTH,
    '● Active Tasks',
    childNodes
  );
}

/**
 * Build the Blocked Tasks group
 */
function buildBlockedTasksGroup(tasks: Task[]): GroupWithNodes {
  const childNodes: CanvasNode[] = [];
  
  for (const task of tasks.slice(0, 10)) {
    // Create a text node showing the blocker info
    const blockerInfo = task.frontmatter.blocked_by || 'unknown';
    const since = task.frontmatter.updated.split('T')[0];
    const text = `**${truncateText(task.title, 30)}**\nBlocked by: ${blockerInfo}\nSince: ${since}`;
    
    childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.DEFAULT_NODE_HEIGHT, text, CANVAS_COLORS.RED));
  }

  return createGroupWithNodes(
    LAYOUT.RIGHT_COLUMN_X,
    0,
    LAYOUT.RIGHT_COLUMN_WIDTH,
    '■ Blocked',
    childNodes,
    CANVAS_COLORS.RED
  );
}

/**
 * Build the Backlog group
 */
function buildBacklogGroup(items: BacklogItem[]): GroupWithNodes {
  const childNodes: CanvasNode[] = [];
  
  // Group by project if > 5 items
  if (items.length > 5) {
    const byProject = new Map<string, BacklogItem[]>();
    for (const item of items) {
      const project = item.frontmatter.project || 'No Project';
      const existing = byProject.get(project) || [];
      existing.push(item);
      byProject.set(project, existing);
    }
    
    for (const [project, projectItems] of byProject) {
      const itemsList = projectItems.slice(0, 5).map(i => `- ${truncateText(i.title, 35)}`).join('\n');
      const moreText = projectItems.length > 5 ? `\n... +${projectItems.length - 5} more` : '';
      const text = `**${project}**\n\n${itemsList}${moreText}`;
      childNodes.push(createTextNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.DEFAULT_NODE_HEIGHT + 20, text));
    }
  } else {
    for (const item of items) {
      const relativePath = `backlog/${item.slug}.md`;
      childNodes.push(createFileNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.FILE_NODE_HEIGHT, relativePath));
    }
  }

  return createGroupWithNodes(
    LAYOUT.RIGHT_COLUMN_X,
    0,
    LAYOUT.RIGHT_COLUMN_WIDTH,
    '📋 Backlog',
    childNodes
  );
}

/**
 * Build the Recently Done group
 */
function buildRecentlyDoneGroup(tasks: Task[]): GroupWithNodes {
  const childNodes: CanvasNode[] = [];
  
  for (const task of tasks.slice(0, 10)) {
    const relativePath = `tasks/${task.slug}.md`;
    childNodes.push(createFileNode(0, 0, LAYOUT.DEFAULT_NODE_WIDTH, LAYOUT.FILE_NODE_HEIGHT, relativePath, CANVAS_COLORS.GREEN));
  }

  return createGroupWithNodes(
    LAYOUT.RIGHT_COLUMN_X,
    0,
    LAYOUT.RIGHT_COLUMN_WIDTH,
    '✓ Recently Done',
    childNodes,
    CANVAS_COLORS.GREEN
  );
}

/**
 * Build the data flow diagram
 */
function buildDataFlowDiagram(startY: number): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  
  const flowSteps = ['Session', 'Observe', 'Score', 'Route', 'Reflect', 'Promote'];
  const nodeWidth = 100;
  const nodeHeight = 40;
  const spacing = 30;
  const totalWidth = flowSteps.length * nodeWidth + (flowSteps.length - 1) * spacing;
  const startX = LAYOUT.LEFT_COLUMN_X + (LAYOUT.LEFT_COLUMN_WIDTH + LAYOUT.RIGHT_COLUMN_WIDTH + 50 - totalWidth) / 2;
  
  // Create group for data flow
  const groupWidth = totalWidth + LAYOUT.GROUP_PADDING * 2;
  const groupHeight = nodeHeight + LAYOUT.GROUP_HEADER_HEIGHT + LAYOUT.GROUP_PADDING * 2;
  const group = createGroupNode(startX - LAYOUT.GROUP_PADDING, startY, groupWidth, groupHeight, 'Data Flow', CANVAS_COLORS.CYAN);
  nodes.push(group);
  
  // Create flow step nodes
  const stepNodes: CanvasNode[] = [];
  let currentX = startX;
  
  for (const step of flowSteps) {
    const node = createTextNode(
      currentX,
      startY + LAYOUT.GROUP_HEADER_HEIGHT + LAYOUT.GROUP_PADDING,
      nodeWidth,
      nodeHeight,
      `**${step}**`
    );
    stepNodes.push(node);
    nodes.push(node);
    currentX += nodeWidth + spacing;
  }
  
  // Create edges between steps
  for (let i = 0; i < stepNodes.length - 1; i++) {
    edges.push(createEdge(stepNodes[i].id, 'right', stepNodes[i + 1].id, 'left', '→'));
  }
  
  return { nodes, edges };
}

/**
 * Canvas command handler for CLI
 */
export async function canvasCommand(
  vaultPath: string,
  options: CanvasOptions = {}
): Promise<void> {
  const resolvedPath = path.resolve(vaultPath);
  const outputPath = options.output || path.join(resolvedPath, 'dashboard.canvas');
  
  const canvas = generateCanvas(resolvedPath);
  
  fs.writeFileSync(outputPath, JSON.stringify(canvas, null, 2));
  
  console.log(`✓ Generated canvas dashboard: ${outputPath}`);
  console.log(`  Nodes: ${canvas.nodes.length}`);
  console.log(`  Edges: ${canvas.edges.length}`);
}
