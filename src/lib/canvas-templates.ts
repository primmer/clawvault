import * as fs from 'fs';
import * as path from 'path';
import {
  createTextNode,
  createGroupNode,
  createGroupWithNodes,
  formatCanvasText,
  LAYOUT,
} from './canvas-layout.js';
import { listTasks } from './task-utils.js';
import { listObservationFiles } from './ledger.js';
import { loadMemoryGraphIndex } from './memory-graph.js';

interface CanvasNode {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  label?: string;
  file?: string;
  color?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide: string;
  toNode: string;
  toSide: string;
  label?: string;
  color?: string;
}

interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export function generateCanvas(vaultPath: string): Canvas {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  let currentX = 0;
  const columnWidth = 500;
  const spacing = 40;

  // --- Vault Status Group ---
  {
    const statusLines = [`Vault: ${vaultPath}`];
    const configPath = path.join(vaultPath, '.clawvault', 'config.json');
    if (fs.existsSync(configPath)) {
      statusLines.push('Config: loaded');
    } else {
      statusLines.push('Config: default');
    }
    const textNode = createTextNode(0, 0, columnWidth - 2 * LAYOUT.GROUP_PADDING, 60, formatCanvasText(statusLines));
    const { group, nodes: children } = createGroupWithNodes(currentX, 0, columnWidth, 'Vault Status', [textNode]);
    nodes.push(group, ...children);
    currentX += columnWidth + spacing;
  }

  // --- Tasks by Status ---
  {
    try {
      const tasks = listTasks(vaultPath);
      if (tasks.length > 0) {
        const byStatus: Record<string, number> = {};
        for (const t of tasks) {
          const s = t.frontmatter?.status || 'open';
          byStatus[s] = (byStatus[s] || 0) + 1;
        }
        const lines = ['Tasks by Status'];
        for (const [status, count] of Object.entries(byStatus)) {
          const label = status.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          lines.push(`${label} (${count})`);
        }
        const textNode = createTextNode(0, 0, columnWidth - 2 * LAYOUT.GROUP_PADDING, 40 + tasks.length * 20, formatCanvasText(lines));
        const { group, nodes: children } = createGroupWithNodes(currentX, 0, columnWidth, 'Tasks', [textNode]);
        nodes.push(group, ...children);
        currentX += columnWidth + spacing;
      }
    } catch {
      // No tasks directory
    }
  }

  // --- Recent Observations ---
  {
    try {
      const obsEntries = listObservationFiles(vaultPath);
      const lines: string[] = [`Total days: ${obsEntries.length}`];
      for (const entry of obsEntries.slice(-10)) {
        try {
          const content = fs.readFileSync(entry.path, 'utf-8');
          const titleMatch = content.match(/^#\s+(.+)/m);
          const title = titleMatch ? titleMatch[1] : 'Observation';
          lines.push(`${entry.date}: ${title}`);
        } catch {
          lines.push(`${entry.date}: (unreadable)`);
        }
      }
      const textNode = createTextNode(0, 0, columnWidth - 2 * LAYOUT.GROUP_PADDING, 40 + obsEntries.length * 20, formatCanvasText(lines));
      const { group, nodes: children } = createGroupWithNodes(currentX, 0, columnWidth, 'Recent Observations', [textNode]);
      nodes.push(group, ...children);
      currentX += columnWidth + spacing;
    } catch {
      const textNode = createTextNode(0, 0, columnWidth - 2 * LAYOUT.GROUP_PADDING, 60, 'Total days: 0');
      const { group, nodes: children } = createGroupWithNodes(currentX, 0, columnWidth, 'Recent Observations', [textNode]);
      nodes.push(group, ...children);
      currentX += columnWidth + spacing;
    }
  }

  // --- Graph Stats ---
  {
    const graphIndex = loadMemoryGraphIndex(vaultPath);
    const graphLines: string[] = ['Graph Stats'];
    if (graphIndex?.graph) {
      const g = graphIndex.graph;
      graphLines.push(`Nodes: ${g.nodes?.length ?? 0}`);
      graphLines.push(`Edges: ${g.edges?.length ?? 0}`);
      if (g.nodes?.length) {
        const types: Record<string, number> = {};
        for (const n of g.nodes) {
          const t = n.type || 'unknown';
          types[t] = (types[t] || 0) + 1;
        }
        graphLines.push(`Node types: ${Object.entries(types).map(([t, c]) => `${t}(${c})`).join(', ')}`);
      }
    } else {
      graphLines.push('Nodes: 0');
      graphLines.push('Edges: 0');
    }
    const textNode = createTextNode(0, 0, columnWidth - 2 * LAYOUT.GROUP_PADDING, 80, formatCanvasText(graphLines));
    const { group, nodes: children } = createGroupWithNodes(currentX, 0, columnWidth, 'Graph Stats', [textNode]);
    nodes.push(group, ...children);
  }

  return { nodes, edges };
}
