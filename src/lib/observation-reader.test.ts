import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  filterByPriority,
  parseObservationLines,
  readObservations
} from './observation-reader.js';

const tempVaults: string[] = [];

function makeTempVault(): string {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-observation-reader-'));
  tempVaults.push(vaultPath);
  return vaultPath;
}

function writeObservation(vaultPath: string, fileName: string, content: string): void {
  const observationsDir = path.join(vaultPath, 'observations');
  fs.mkdirSync(observationsDir, { recursive: true });
  fs.writeFileSync(path.join(observationsDir, fileName), content, 'utf-8');
}

afterEach(() => {
  while (tempVaults.length > 0) {
    const vaultPath = tempVaults.pop() as string;
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

describe('observation-reader', () => {
  it('reads only most recent observation files for the requested day count', () => {
    const vaultPath = makeTempVault();
    writeObservation(vaultPath, '2026-02-09.md', '## 2026-02-09\n\n🟢 10:00 old');
    writeObservation(vaultPath, '2026-02-10.md', '## 2026-02-10\n\n🟡 10:00 middle');
    writeObservation(vaultPath, '2026-02-11.md', '## 2026-02-11\n\n🔴 10:00 newest');

    const markdown = readObservations(vaultPath, 2);
    expect(markdown).toContain('2026-02-11');
    expect(markdown).toContain('2026-02-10');
    expect(markdown).not.toContain('2026-02-09');
  });

  it('returns empty when observations directory is missing', () => {
    const vaultPath = makeTempVault();
    expect(readObservations(vaultPath, 2)).toBe('');
  });

  it('parses observation lines with priority, content, and date', () => {
    const markdown = [
      '## 2026-02-11',
      '',
      '🔴 09:15 Chose PostgreSQL for reliability',
      '🟡 10:20 Noted migration pattern',
      '',
      '## 2026-02-10',
      '',
      '🟢 08:00 General note'
    ].join('\n');

    const lines = parseObservationLines(markdown);
    expect(lines).toEqual([
      {
        priority: '🔴',
        content: '09:15 Chose PostgreSQL for reliability',
        date: '2026-02-11'
      },
      {
        priority: '🟡',
        content: '10:20 Noted migration pattern',
        date: '2026-02-11'
      },
      {
        priority: '🟢',
        content: '08:00 General note',
        date: '2026-02-10'
      }
    ]);
  });

  it('filters observations by minimum priority threshold', () => {
    const markdown = [
      '## 2026-02-11',
      '',
      '🔴 09:15 Critical decision',
      '🟡 10:20 Notable pattern',
      '🟢 11:30 Routine update'
    ].join('\n');

    const criticalAndNotable = filterByPriority(markdown, '🟡');
    expect(criticalAndNotable).toContain('🔴 09:15 Critical decision');
    expect(criticalAndNotable).toContain('🟡 10:20 Notable pattern');
    expect(criticalAndNotable).not.toContain('🟢 11:30 Routine update');
  });
});
