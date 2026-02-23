import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EntityGraph } from './entity-graph.js';

function tempVaultPath(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-entity-graph-'));
}

describe('EntityGraph', () => {
  it('supports fact ingestion, multi-hop traversal, and persistence', () => {
    const vaultPath = tempVaultPath();
    try {
      const graph = new EntityGraph(vaultPath);
      graph.addFact({
        subject: 'Alice',
        predicate: 'works_at',
        object: 'Acme',
        sourceText: 'Alice works at Acme.',
        extractedAt: new Date('2026-01-02T00:00:00.000Z').toISOString()
      });
      graph.addFact({
        subject: 'Acme',
        predicate: 'located_in',
        object: 'Berlin',
        sourceText: 'Acme is located in Berlin.',
        extractedAt: new Date('2026-01-03T00:00:00.000Z').toISOString()
      });
      graph.addFact({
        subject: 'Bob',
        predicate: 'works_at',
        object: 'Acme',
        sourceText: 'Bob works at Acme.',
        extractedAt: new Date('2026-01-04T00:00:00.000Z').toISOString()
      });

      const oneHop = graph.query('Alice');
      expect(oneHop.nodes.some((node) => node.name === 'Acme')).toBe(true);

      const twoHop = graph.queryMultiHop('Alice', 2);
      expect(twoHop.nodes.some((node) => node.name === 'Berlin')).toBe(true);
      expect(twoHop.edges.some((edge) => edge.relation === 'located_in')).toBe(true);

      const related = graph.findRelated('Alice');
      expect(related.length).toBeGreaterThan(0);
      expect(related[0]?.node.name).toBe('Acme');

      const timeline = graph.getTimeline('Alice');
      expect(timeline[0]).toMatchObject({
        relation: 'works_at',
        direction: 'outgoing',
        with: 'Acme'
      });

      const formatted = graph.formatForContext(twoHop);
      expect(formatted).toContain('Entity graph');
      expect(formatted).toContain('Alice');

      graph.save();
      const reloaded = EntityGraph.load(vaultPath);
      const reloadedQuery = reloaded.queryMultiHop('Alice', 2);
      expect(reloadedQuery.nodes.some((node) => node.name === 'Berlin')).toBe(true);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});
