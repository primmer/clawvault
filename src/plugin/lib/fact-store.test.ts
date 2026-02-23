import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FactStore } from './fact-store.js';
import type { ExtractedFact } from './fact-extractor.js';

function tempVaultPath(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-facts-'));
}

describe('FactStore', () => {
  it('adds, deduplicates, and persists facts', () => {
    const vaultPath = tempVaultPath();
    try {
      const store = new FactStore(vaultPath);
      const fact: ExtractedFact = {
        subject: 'Alice',
        predicate: 'works_at',
        object: 'Acme',
        confidence: 0.9,
        sourceText: 'Alice works at Acme.',
        extractedAt: new Date('2026-01-01T00:00:00.000Z').toISOString()
      };

      const addedFirst = store.addFact(fact, 'session-1');
      const addedSecond = store.addFact(fact, 'session-1');

      expect(addedFirst).not.toBeNull();
      expect(addedSecond).toBeNull();
      expect(store.getAllFacts()).toHaveLength(1);

      store.save();
      const reloaded = FactStore.load(vaultPath);
      expect(reloaded.getAllFacts()).toHaveLength(1);
      expect(reloaded.getFactsForEntity('alice')[0]).toMatchObject({
        subject: 'Alice',
        object: 'Acme'
      });
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});
