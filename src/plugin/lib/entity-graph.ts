import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StoredFact } from './fact-store.js';

const ENTITY_GRAPH_SCHEMA_VERSION = 1;
const ENTITY_GRAPH_RELATIVE_PATH = path.join('.clawvault', 'entity-graph.json');

export interface EntityNode {
  id: string;
  name: string;
  mentions: number;
  firstSeen: string;
  lastSeen: string;
}

export interface EntityEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
  firstSeen: string;
  lastSeen: string;
  evidence: string[];
}

export interface EntityGraphQueryResult {
  seedEntityIds: string[];
  hops: number;
  nodes: EntityNode[];
  edges: EntityEdge[];
}

export interface TimelineEntry {
  when: string;
  relation: string;
  direction: 'outgoing' | 'incoming';
  with: string;
  evidence?: string;
}

interface EntityGraphSnapshot {
  schemaVersion: number;
  updatedAt: string;
  nodes: EntityNode[];
  edges: EntityEdge[];
}

function ensureClawvaultDir(vaultPath: string): string {
  const clawvaultDir = path.join(vaultPath, '.clawvault');
  if (!fs.existsSync(clawvaultDir)) {
    fs.mkdirSync(clawvaultDir, { recursive: true });
  }
  return clawvaultDir;
}

function normalizeEntity(entity: string): string {
  return entity.trim().toLowerCase();
}

function edgeId(source: string, relation: string, target: string): string {
  return `${source}|${relation}|${target}`;
}

function isValidSnapshot(input: unknown): input is EntityGraphSnapshot {
  if (!input || typeof input !== 'object') return false;
  const snapshot = input as EntityGraphSnapshot;
  return snapshot.schemaVersion === ENTITY_GRAPH_SCHEMA_VERSION && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.edges);
}

export class EntityGraph {
  private readonly storagePath: string;
  private readonly nodes = new Map<string, EntityNode>();
  private readonly edges = new Map<string, EntityEdge>();
  private readonly adjacency = new Map<string, Set<string>>();

  constructor(private readonly vaultPath: string, seedNodes: EntityNode[] = [], seedEdges: EntityEdge[] = []) {
    this.storagePath = path.join(vaultPath, ENTITY_GRAPH_RELATIVE_PATH);
    for (const node of seedNodes) {
      this.nodes.set(node.id, node);
      this.ensureAdjacency(node.id);
    }
    for (const edge of seedEdges) {
      this.edges.set(edge.id, edge);
      this.linkAdjacency(edge.source, edge.target);
    }
  }

  static load(vaultPath: string): EntityGraph {
    const resolvedVaultPath = path.resolve(vaultPath);
    const graphPath = path.join(resolvedVaultPath, ENTITY_GRAPH_RELATIVE_PATH);
    if (!fs.existsSync(graphPath)) {
      return new EntityGraph(resolvedVaultPath);
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as unknown;
      if (!isValidSnapshot(parsed)) {
        return new EntityGraph(resolvedVaultPath);
      }
      return new EntityGraph(resolvedVaultPath, parsed.nodes, parsed.edges);
    } catch {
      return new EntityGraph(resolvedVaultPath);
    }
  }

  addFact(fact: Pick<StoredFact, 'subject' | 'predicate' | 'object' | 'sourceText' | 'extractedAt'>): void {
    const subjectName = fact.subject.trim();
    const objectName = fact.object.trim();
    const relation = fact.predicate.trim().toLowerCase();
    if (!subjectName || !objectName || !relation) return;

    const observedAt = fact.extractedAt || new Date().toISOString();
    const subjectId = this.upsertNode(subjectName, observedAt);
    const objectId = this.upsertNode(objectName, observedAt);

    const id = edgeId(subjectId, relation, objectId);
    const existing = this.edges.get(id);

    if (!existing) {
      this.edges.set(id, {
        id,
        source: subjectId,
        target: objectId,
        relation,
        weight: 1,
        firstSeen: observedAt,
        lastSeen: observedAt,
        evidence: fact.sourceText ? [fact.sourceText] : []
      });
      this.linkAdjacency(subjectId, objectId);
      return;
    }

    existing.weight += 1;
    existing.lastSeen = observedAt;
    if (fact.sourceText) {
      existing.evidence = [fact.sourceText, ...existing.evidence].slice(0, 8);
    }
    this.edges.set(id, existing);
  }

  query(entity: string, limit: number = 30): EntityGraphQueryResult {
    const seedEntityIds = this.matchingEntityIds(entity);
    if (seedEntityIds.length === 0) {
      return { seedEntityIds: [], hops: 1, nodes: [], edges: [] };
    }

    const candidateEdges = [...this.edges.values()].filter(
      (edge) => seedEntityIds.includes(edge.source) || seedEntityIds.includes(edge.target)
    );

    const topEdges = candidateEdges
      .sort((a, b) => b.weight - a.weight || b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, limit);

    const nodeIds = new Set(seedEntityIds);
    for (const edge of topEdges) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }

    return {
      seedEntityIds,
      hops: 1,
      nodes: this.sortedNodes(nodeIds),
      edges: topEdges
    };
  }

  queryMultiHop(entity: string, maxHops: number = 2, edgeLimit: number = 60): EntityGraphQueryResult {
    const seedEntityIds = this.matchingEntityIds(entity);
    if (seedEntityIds.length === 0) {
      return { seedEntityIds: [], hops: maxHops, nodes: [], edges: [] };
    }

    const visited = new Set<string>(seedEntityIds);
    const queue: Array<{ nodeId: string; depth: number }> = seedEntityIds.map((nodeId) => ({ nodeId, depth: 0 }));

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (current.depth >= maxHops) continue;

      const neighbors = this.adjacency.get(current.nodeId);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push({ nodeId: neighbor, depth: current.depth + 1 });
      }
    }

    const candidateEdges = [...this.edges.values()].filter(
      (edge) => visited.has(edge.source) && visited.has(edge.target)
    );
    const edges = candidateEdges
      .sort((a, b) => b.weight - a.weight || b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, edgeLimit);

    const nodeIds = new Set<string>(seedEntityIds);
    for (const edge of edges) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }

    return {
      seedEntityIds,
      hops: maxHops,
      nodes: this.sortedNodes(nodeIds),
      edges
    };
  }

  findRelated(entity: string, limit: number = 10): Array<{ node: EntityNode; score: number; via: string[] }> {
    const seedEntityIds = this.matchingEntityIds(entity);
    if (seedEntityIds.length === 0) return [];

    const scores = new Map<string, { score: number; via: Set<string> }>();
    for (const edge of this.edges.values()) {
      for (const seed of seedEntityIds) {
        if (edge.source === seed || edge.target === seed) {
          const otherId = edge.source === seed ? edge.target : edge.source;
          if (seedEntityIds.includes(otherId)) continue;
          const current = scores.get(otherId) ?? { score: 0, via: new Set<string>() };
          current.score += edge.weight;
          current.via.add(edge.relation);
          scores.set(otherId, current);
        }
      }
    }

    return [...scores.entries()]
      .map(([nodeId, data]) => ({
        node: this.nodes.get(nodeId),
        score: data.score,
        via: [...data.via].sort((a, b) => a.localeCompare(b))
      }))
      .filter((entry): entry is { node: EntityNode; score: number; via: string[] } => Boolean(entry.node))
      .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name))
      .slice(0, limit);
  }

  getTimeline(entity: string): TimelineEntry[] {
    const seedEntityIds = this.matchingEntityIds(entity);
    if (seedEntityIds.length === 0) return [];

    const timeline: TimelineEntry[] = [];
    for (const edge of this.edges.values()) {
      const sourceNode = this.nodes.get(edge.source);
      const targetNode = this.nodes.get(edge.target);
      if (!sourceNode || !targetNode) continue;

      for (const seed of seedEntityIds) {
        if (edge.source === seed) {
          timeline.push({
            when: edge.lastSeen,
            relation: edge.relation,
            direction: 'outgoing',
            with: targetNode.name,
            evidence: edge.evidence[0]
          });
        } else if (edge.target === seed) {
          timeline.push({
            when: edge.lastSeen,
            relation: edge.relation,
            direction: 'incoming',
            with: sourceNode.name,
            evidence: edge.evidence[0]
          });
        }
      }
    }

    return timeline.sort((a, b) => b.when.localeCompare(a.when));
  }

  formatForContext(input: EntityGraphQueryResult | string, maxLines: number = 14): string {
    const result = typeof input === 'string' ? this.queryMultiHop(input, 2) : input;
    if (result.nodes.length === 0 || result.edges.length === 0) {
      return 'No entity graph matches found.';
    }

    const nodeNameById = new Map(result.nodes.map((node) => [node.id, node.name]));
    const lines: string[] = [];
    lines.push(`Entity graph (${result.hops}-hop):`);

    for (const edge of result.edges.slice(0, maxLines)) {
      const source = nodeNameById.get(edge.source) ?? edge.source;
      const target = nodeNameById.get(edge.target) ?? edge.target;
      lines.push(`- ${source} --${edge.relation}--> ${target} (weight ${edge.weight})`);
    }

    return lines.join('\n');
  }

  save(): void {
    ensureClawvaultDir(this.vaultPath);
    const snapshot: EntityGraphSnapshot = {
      schemaVersion: ENTITY_GRAPH_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      nodes: [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...this.edges.values()].sort((a, b) => a.id.localeCompare(b.id))
    };
    fs.writeFileSync(this.storagePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  private upsertNode(name: string, observedAt: string): string {
    const normalized = normalizeEntity(name);
    const id = normalized;
    const existing = this.nodes.get(id);
    if (!existing) {
      this.nodes.set(id, {
        id,
        name: name.trim(),
        mentions: 1,
        firstSeen: observedAt,
        lastSeen: observedAt
      });
      this.ensureAdjacency(id);
      return id;
    }

    existing.mentions += 1;
    existing.lastSeen = observedAt;
    if (name.length > existing.name.length) {
      existing.name = name.trim();
    }
    this.nodes.set(id, existing);
    this.ensureAdjacency(id);
    return id;
  }

  private matchingEntityIds(entity: string): string[] {
    const needle = normalizeEntity(entity);
    if (!needle) return [];

    const exact = this.nodes.get(needle);
    if (exact) {
      return [exact.id];
    }

    return [...this.nodes.values()]
      .filter((node) => node.id.includes(needle) || node.name.toLowerCase().includes(needle))
      .map((node) => node.id)
      .slice(0, 8);
  }

  private sortedNodes(nodeIds: Set<string>): EntityNode[] {
    return [...nodeIds]
      .map((nodeId) => this.nodes.get(nodeId))
      .filter((node): node is EntityNode => Boolean(node))
      .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
  }

  private ensureAdjacency(nodeId: string): void {
    if (!this.adjacency.has(nodeId)) {
      this.adjacency.set(nodeId, new Set<string>());
    }
  }

  private linkAdjacency(source: string, target: string): void {
    this.ensureAdjacency(source);
    this.ensureAdjacency(target);
    this.adjacency.get(source)?.add(target);
    this.adjacency.get(target)?.add(source);
  }
}
