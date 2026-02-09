import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVaultGraph } from './vault-parser.js';

function makeTempVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-dashboard-'));
}

function writeVaultFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

describe('buildVaultGraph', () => {
  it('builds nodes and edges from markdown wiki-links', async () => {
    const vaultPath = makeTempVault();
    try {
      writeVaultFile(
        vaultPath,
        'decisions/use-clawvault.md',
        `---
title: Use ClawVault
tags: [architecture, memory]
---
Linked to [[projects/clawvault|ClawVault Project]] and [[missing-note]].
`
      );
      writeVaultFile(vaultPath, 'projects/clawvault.md', '# ClawVault');

      const graph = await buildVaultGraph(vaultPath);
      const decisionNode = graph.nodes.find((node) => node.id === 'decisions/use-clawvault');
      const unresolvedNode = graph.nodes.find((node) => node.id === 'missing-note');

      expect(decisionNode).toMatchObject({
        title: 'Use ClawVault',
        category: 'decisions',
        tags: ['architecture', 'memory']
      });
      expect(graph.edges).toEqual(
        expect.arrayContaining([
          { source: 'decisions/use-clawvault', target: 'projects/clawvault' },
          { source: 'decisions/use-clawvault', target: 'missing-note' }
        ])
      );
      expect(unresolvedNode).toMatchObject({
        missing: true,
        category: 'unresolved'
      });
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('resolves basename links when there is a unique match', async () => {
    const vaultPath = makeTempVault();
    try {
      writeVaultFile(vaultPath, 'research/notes.md', 'See [[clawvault]].');
      writeVaultFile(vaultPath, 'projects/clawvault.md', '# ClawVault');

      const graph = await buildVaultGraph(vaultPath);

      expect(graph.edges).toEqual(
        expect.arrayContaining([
          { source: 'research/notes', target: 'projects/clawvault' }
        ])
      );
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});
