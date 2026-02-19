import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractEntities,
  entitySimilarity,
  isKnowledgeUpdate,
  isSuperseded,
  getSupersessionInfo,
  filterSuperseded,
  stripSupersededObservations,
  reweave,
} from './reweave.js';
import type { ParsedObservationRecord, ObservationType } from './observation-format.js';

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

describe('extractEntities', () => {
  it('extracts significant words', () => {
    const entities = extractEntities('Pedro switched to Neovim for editing');
    expect(entities).toContain('neovim');
    expect(entities).toContain('editing');
  });

  it('extracts quoted values', () => {
    const entities = extractEntities('Favorite editor is "VS Code"');
    expect(entities.some(e => e.includes('vs code'))).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(extractEntities('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Entity similarity
// ---------------------------------------------------------------------------

describe('entitySimilarity', () => {
  it('returns 1 for identical sets', () => {
    expect(entitySimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(entitySimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('returns partial overlap', () => {
    const sim = entitySimilarity(['a', 'b', 'c'], ['b', 'c', 'd']);
    expect(sim).toBeCloseTo(0.5, 1);
  });

  it('handles empty arrays', () => {
    expect(entitySimilarity([], ['a'])).toBe(0);
    expect(entitySimilarity(['a'], [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Knowledge update detection
// ---------------------------------------------------------------------------

describe('isKnowledgeUpdate', () => {
  const makeObs = (content: string, date: string, type: ObservationType = 'fact'): ParsedObservationRecord => ({
    date,
    type,
    confidence: 0.9,
    importance: 0.8,
    content,
    format: 'scored',
    rawLine: `- [${type}|c=0.90|i=0.80] ${content}`,
  });

  it('detects knowledge update when same entity has new value', () => {
    const older = makeObs("Pedro's favorite editor is VS Code", '2024-01-01');
    const newer = makeObs("Pedro's favorite editor is Neovim", '2024-06-01');
    const result = isKnowledgeUpdate(older, newer);
    expect(result.isUpdate).toBe(true);
  });

  it('rejects identical content as not an update', () => {
    const older = makeObs("Pedro uses VS Code", '2024-01-01');
    const newer = makeObs("Pedro uses VS Code", '2024-06-01');
    const result = isKnowledgeUpdate(older, newer);
    expect(result.isUpdate).toBe(false);
    expect(result.reason).toBe('identical content');
  });

  it('rejects unrelated observations', () => {
    const older = makeObs("Pedro likes pizza", '2024-01-01');
    const newer = makeObs("The server deployment failed", '2024-06-01');
    const result = isKnowledgeUpdate(older, newer);
    expect(result.isUpdate).toBe(false);
  });

  it('skips non-updateable types', () => {
    const older = makeObs("Learned about testing", '2024-01-01', 'lesson');
    const newer = makeObs("Learned more about testing", '2024-06-01', 'lesson');
    const result = isKnowledgeUpdate(older, newer);
    expect(result.isUpdate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Supersession markers
// ---------------------------------------------------------------------------

describe('supersession markers', () => {
  it('detects superseded lines', () => {
    const line = '- [fact|c=0.90|i=0.80] Old fact [superseded|by=2024-06-01|detected=2024-07-01]';
    expect(isSuperseded(line)).toBe(true);
  });

  it('returns false for normal lines', () => {
    expect(isSuperseded('- [fact|c=0.90|i=0.80] Normal fact')).toBe(false);
  });

  it('extracts supersession info', () => {
    const line = '- [fact|c=0.90|i=0.80] Old fact [superseded|by=2024-06-01|detected=2024-07-01]';
    const info = getSupersessionInfo(line);
    expect(info).toEqual({ supersededBy: '2024-06-01', detectedAt: '2024-07-01' });
  });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe('filterSuperseded', () => {
  it('removes superseded lines', () => {
    const lines = [
      '- [fact|c=0.90|i=0.80] Current fact',
      '- [fact|c=0.90|i=0.80] Old fact [superseded|by=2024-06-01|detected=2024-07-01]',
      '- [fact|c=0.90|i=0.80] Another current fact',
    ];
    const filtered = filterSuperseded(lines);
    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toContain('Current fact');
    expect(filtered[1]).toContain('Another current fact');
  });
});

describe('stripSupersededObservations', () => {
  it('strips superseded lines but keeps structure', () => {
    const md = `## 2024-01-01

- [fact|c=0.90|i=0.80] Old fact [superseded|by=2024-06-01|detected=2024-07-01]
- [fact|c=0.90|i=0.80] Current fact

## 2024-06-01

- [fact|c=0.90|i=0.80] Updated fact`;

    const result = stripSupersededObservations(md);
    expect(result).not.toContain('Old fact');
    expect(result).toContain('Current fact');
    expect(result).toContain('Updated fact');
    expect(result).toContain('## 2024-01-01');
  });
});

// ---------------------------------------------------------------------------
// Full reweave integration test
// ---------------------------------------------------------------------------

describe('reweave', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-reweave-'));
    // Create ledger/observations structure
    const obsDir = path.join(tmpDir, 'ledger', 'observations', '2024', '01');
    fs.mkdirSync(obsDir, { recursive: true });
    const obsDir2 = path.join(tmpDir, 'ledger', 'observations', '2024', '06');
    fs.mkdirSync(obsDir2, { recursive: true });

    // Older observation
    fs.writeFileSync(path.join(obsDir, '15.md'), `## 2024-01-15

- [fact|c=0.90|i=0.80] Pedro's favorite editor is VS Code
- [fact|c=0.90|i=0.70] The weather was sunny
`);

    // Newer observation with updated fact
    fs.writeFileSync(path.join(obsDir2, '01.md'), `## 2024-06-01

- [fact|c=0.90|i=0.80] Pedro's favorite editor is Neovim
- [fact|c=0.90|i=0.60] Deployed version 2.0
`);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects supersessions in dry-run mode', () => {
    const result = reweave({ vaultPath: tmpDir, dryRun: true });
    expect(result.filesScanned).toBe(2);
    expect(result.observationsChecked).toBe(4);
    expect(result.dryRun).toBe(true);
    // Should find the editor preference update
    const editorSupersession = result.supersessions.find(
      s => s.oldObservation.content.includes('VS Code') &&
           s.newObservation.content.includes('Neovim')
    );
    expect(editorSupersession).toBeDefined();
  });

  it('applies supersession markers when not dry-run', () => {
    const result = reweave({ vaultPath: tmpDir, dryRun: false });
    expect(result.supersessions.length).toBeGreaterThan(0);

    // Check the old file was updated
    const oldContent = fs.readFileSync(
      path.join(tmpDir, 'ledger', 'observations', '2024', '01', '15.md'),
      'utf-8'
    );
    expect(oldContent).toContain('[superseded|by=');
    expect(oldContent).toContain('VS Code');
    // Weather observation should not be superseded
    expect(oldContent).toMatch(/sunny(?!.*superseded)/);
  });

  it('respects --since filter', () => {
    const result = reweave({ vaultPath: tmpDir, since: '2024-06-01', dryRun: true });
    // Should still find supersessions (comparing new against all old)
    expect(result.filesScanned).toBe(2);
  });
});
