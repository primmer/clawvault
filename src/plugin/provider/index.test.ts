import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClawVaultMemoryProvider } from './index.js';
import { FactStore } from '../lib/fact-store.js';
import { EntityGraph } from '../lib/entity-graph.js';
import type { Message } from '../types.js';

function tempVaultPath(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-provider-'));
}

function createProviderWithStubs(vaultPath: string): ClawVaultMemoryProvider {
  const provider = new ClawVaultMemoryProvider({
    vaultPath,
    defaultLimit: 5
  });

  const fakeVault = {
    isInitialized: () => true,
    stats: async () => ({ documents: 0, categories: {} }),
    get: async () => null,
    store: async () => undefined,
    find: async () => [
      {
        score: 0.92,
        snippet: 'semantic match',
        document: {
          id: 'doc:1',
          title: 'Semantic Match',
          content: 'semantic content',
          category: 'notes',
          path: 'notes/semantic.md',
          modified: new Date('2026-01-01T00:00:00.000Z')
        }
      }
    ]
  };

  (provider as unknown as {
    vault: unknown;
    observer: unknown;
    factStore: FactStore;
    entityGraph: EntityGraph;
  }).vault = fakeVault;
  (provider as unknown as { observer: unknown }).observer = {
    processMessages: async () => undefined
  };
  (provider as unknown as { factStore: FactStore }).factStore = FactStore.load(vaultPath);
  (provider as unknown as { entityGraph: EntityGraph }).entityGraph = EntityGraph.load(vaultPath);

  return provider;
}

describe('ClawVaultMemoryProvider entity graph integration', () => {
  it('extracts user facts at ingest and updates graph', async () => {
    const vaultPath = tempVaultPath();
    try {
      const provider = createProviderWithStubs(vaultPath);
      const messages: Message[] = [
        { role: 'user', content: 'Alice works at Acme.' },
        { role: 'assistant', content: 'Noted.' },
        { role: 'user', content: 'Acme is based in Berlin.' }
      ];

      await provider.ingest('session-42', messages, new Date('2026-01-05T00:00:00.000Z'));

      const factStore = (provider as unknown as { factStore: FactStore }).factStore;
      const entityGraph = (provider as unknown as { entityGraph: EntityGraph }).entityGraph;

      expect(factStore.getFactsForEntity('Alice').length).toBeGreaterThan(0);
      expect(entityGraph.queryMultiHop('Alice', 2).nodes.some((node) => node.name === 'Berlin')).toBe(true);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('checks entity graph first for entity queries and falls back for semantic queries', async () => {
    const vaultPath = tempVaultPath();
    try {
      const provider = createProviderWithStubs(vaultPath);
      const messages: Message[] = [{ role: 'user', content: 'Alice works at Acme.' }];
      await provider.ingest('session-43', messages, new Date('2026-01-06T00:00:00.000Z'));

      const entityResults = await provider.search('related to Alice', { queryType: 'entity', limit: 5 });
      expect(entityResults).toHaveLength(1);
      expect(entityResults[0]).toMatchObject({
        category: 'entity-graph'
      });
      expect(entityResults[0].content).toContain('Alice');

      const semanticResults = await provider.search('random semantic question', { queryType: 'semantic', limit: 5 });
      expect(semanticResults[0]).toMatchObject({
        id: 'doc:1',
        title: 'Semantic Match'
      });
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});
