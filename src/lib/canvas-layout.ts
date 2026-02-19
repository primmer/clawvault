import * as crypto from 'crypto';

export const CANVAS_COLORS = {
  RED: '1',
  ORANGE: '2',
  YELLOW: '3',
  GREEN: '4',
  CYAN: '5',
  PURPLE: '6',
} as const;

export const LAYOUT = {
  GROUP_PADDING: 20,
  NODE_SPACING: 10,
  HEADER_HEIGHT: 40,
} as const;

export function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function createTextNode(x: number, y: number, width: number, height: number, text: string, color?: string) {
  const node: any = { id: generateId(), type: 'text', x, y, width, height, text };
  if (color !== undefined) node.color = color;
  return node;
}

export function createFileNode(x: number, y: number, width: number, height: number, file: string, color?: string) {
  const node: any = { id: generateId(), type: 'file', x, y, width, height, file };
  if (color !== undefined) node.color = color;
  return node;
}

export function createGroupNode(x: number, y: number, width: number, height: number, label: string, color?: string) {
  const node: any = { id: generateId(), type: 'group', x, y, width, height, label };
  if (color !== undefined) node.color = color;
  return node;
}

export function createEdge(fromNode: string, fromSide: string, toNode: string, toSide: string, label?: string, color?: string) {
  const edge: any = { id: generateId(), fromNode, fromSide, toNode, toSide };
  if (label !== undefined) edge.label = label;
  if (color !== undefined) edge.color = color;
  return edge;
}

export function stackNodesVertically(nodes: any[], startX: number, startY: number, spacing: number) {
  let currentY = startY;
  const positioned = nodes.map(node => {
    const n = { ...node, x: startX, y: currentY };
    currentY += node.height + spacing;
    return n;
  });
  return { nodes: positioned, totalHeight: currentY - startY - spacing };
}

export function createGroupWithNodes(x: number, y: number, width: number, label: string, childNodes: any[], color?: string) {
  const padding = LAYOUT.GROUP_PADDING;
  const headerHeight = LAYOUT.HEADER_HEIGHT;
  const spacing = LAYOUT.NODE_SPACING;

  const { nodes, totalHeight } = stackNodesVertically(childNodes, x + padding, y + headerHeight, spacing);
  const groupHeight = headerHeight + totalHeight + padding;

  const group = createGroupNode(x, y, width, Math.max(groupHeight, 100), label, color);

  return { group, nodes };
}

export function getPriorityColor(priority: string | undefined): string | undefined {
  switch (priority) {
    case 'critical': return CANVAS_COLORS.RED;
    case 'high': return CANVAS_COLORS.ORANGE;
    case 'medium': return CANVAS_COLORS.YELLOW;
    default: return undefined;
  }
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function formatCanvasText(lines: string[]): string {
  return lines.join('\n');
}
