import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';

export interface ControlPlaneSnapshot {
  generatedAt: string;
  graph: {
    nodeCount: number;
    edgeCount: number;
    topNodeTypes: Array<{ type: string; count: number }>;
  };
  workstreams: Array<{
    workspace: string;
    projectCount: number;
    taskCounts: { open: number; inProgress: number; blocked: number; done: number };
    activeRuns: number;
    activeTriggers: number;
  }>;
  opsRail: Array<{
    timestamp: string;
    primitive: string;
    primitiveId: string;
    action: string;
    writer: string;
  }>;
}

export function parseSnapshot(raw: string): ControlPlaneSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as ControlPlaneSnapshot;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.graph || !Array.isArray(parsed.workstreams) || !Array.isArray(parsed.opsRail)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function resolveSnapshotPath(snapshotPath: string, vaultBasePath: string): string {
  if (isAbsolute(snapshotPath)) {
    return snapshotPath;
  }
  return join(vaultBasePath, snapshotPath);
}

export function readSnapshotFromPath(snapshotPath: string): ControlPlaneSnapshot | null {
  if (!existsSync(snapshotPath)) return null;
  const raw = readFileSync(snapshotPath, 'utf-8');
  return parseSnapshot(raw);
}

export function opsRailLines(snapshot: ControlPlaneSnapshot, limit: number = 25): string[] {
  return snapshot.opsRail.slice(0, limit).map((item) => {
    return `${item.timestamp} — ${item.primitive}/${item.action} (${item.writer})`;
  });
}
