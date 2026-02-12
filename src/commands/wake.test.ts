import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SessionRecap } from '../types.js';

const { recoverMock, clearDirtyFlagMock, generateRecapMock, formatRecapMock } = vi.hoisted(() => ({
  recoverMock: vi.fn(),
  clearDirtyFlagMock: vi.fn(),
  generateRecapMock: vi.fn(),
  formatRecapMock: vi.fn()
}));

vi.mock('./recover.js', () => ({
  recover: recoverMock
}));

vi.mock('./checkpoint.js', () => ({
  clearDirtyFlag: clearDirtyFlagMock
}));

vi.mock('../lib/vault.js', () => ({
  ClawVault: class {
    async load(): Promise<void> {
      return;
    }

    async generateRecap(): Promise<SessionRecap> {
      return generateRecapMock();
    }

    formatRecap(recap: SessionRecap, options: { brief?: boolean }): string {
      return formatRecapMock(recap, options);
    }
  }
}));

import { wake } from './wake.js';

function makeTempVaultDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-wake-'));
  fs.mkdirSync(path.join(root, 'observations'), { recursive: true });
  return root;
}

function toDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('wake', () => {
  it('includes today and yesterday red/yellow observations in recap', async () => {
    const vaultPath = makeTempVaultDir();
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    fs.writeFileSync(
      path.join(vaultPath, 'observations', `${toDateKey(today)}.md`),
      [
        `## ${toDateKey(today)}`,
        '',
        '🔴 09:00 Database migration failed',
        '🟢 09:15 Refactored helper',
        '🟡 10:00 User prefers npm scripts'
      ].join('\n'),
      'utf-8'
    );

    fs.writeFileSync(
      path.join(vaultPath, 'observations', `${toDateKey(yesterday)}.md`),
      [
        `## ${toDateKey(yesterday)}`,
        '',
        '🟡 17:10 Decided to split observer parser',
        '🟢 17:30 Updated comments'
      ].join('\n'),
      'utf-8'
    );

    recoverMock.mockResolvedValue({
      died: false,
      checkpoint: { workingOn: 'Continue observer integration' },
      deathTime: null,
      recoveryMessage: 'ok'
    });
    generateRecapMock.mockResolvedValue({
      generated: new Date().toISOString(),
      recentHandoffs: [],
      activeProjects: [],
      pendingCommitments: [],
      recentDecisions: [],
      recentLessons: [],
      keyRelationships: []
    });
    formatRecapMock.mockReturnValue('# Who I Was\n\nBase recap');

    const result = await wake({ vaultPath, brief: true, handoffLimit: 2 });

    expect(result.observations).toContain('🔴 09:00 Database migration failed');
    expect(result.observations).toContain('🟡 10:00 User prefers npm scripts');
    expect(result.observations).toContain('🟡 17:10 Decided to split observer parser');
    expect(result.observations).not.toContain('🟢');
    expect(result.recapMarkdown).toContain('## Recent Observations');
    expect(result.recapMarkdown).toContain('🔴 09:00 Database migration failed');
    expect(result.summary).toContain('Continue observer integration');
    expect(result.summary).toContain('🔴 09:00 Database migration failed');

    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('returns an empty-observations message when no recent highlights exist', async () => {
    const vaultPath = makeTempVaultDir();
    recoverMock.mockResolvedValue({
      died: false,
      checkpoint: null,
      deathTime: null,
      recoveryMessage: 'ok'
    });
    generateRecapMock.mockResolvedValue({
      generated: new Date().toISOString(),
      recentHandoffs: [],
      activeProjects: ['Core API'],
      pendingCommitments: [],
      recentDecisions: [],
      recentLessons: [],
      keyRelationships: []
    });
    formatRecapMock.mockReturnValue('# Who I Was\n\nBase recap');

    const result = await wake({ vaultPath });

    expect(result.observations).toContain('No critical or notable observations');
    expect(result.recapMarkdown).toContain('## Recent Observations');
    expect(result.summary).toBe('Core API');

    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('limits wake observation output and appends overflow hint', async () => {
    const vaultPath = makeTempVaultDir();
    const today = new Date();
    const todayKey = toDateKey(today);
    const redLines = Array.from({ length: 25 }, (_, index) => `🔴 09:${String(index).padStart(2, '0')} Critical issue ${index + 1}`);
    const yellowLines = Array.from({ length: 15 }, (_, index) => `🟡 10:${String(index).padStart(2, '0')} Notable context ${index + 1}`);

    fs.writeFileSync(
      path.join(vaultPath, 'observations', `${todayKey}.md`),
      [`## ${todayKey}`, '', ...redLines, ...yellowLines].join('\n'),
      'utf-8'
    );

    recoverMock.mockResolvedValue({
      died: false,
      checkpoint: null,
      deathTime: null,
      recoveryMessage: 'ok'
    });
    generateRecapMock.mockResolvedValue({
      generated: new Date().toISOString(),
      recentHandoffs: [],
      activeProjects: [],
      pendingCommitments: [],
      recentDecisions: [],
      recentLessons: [],
      keyRelationships: []
    });
    formatRecapMock.mockReturnValue('# Who I Was\n\nBase recap');

    const result = await wake({ vaultPath, brief: true, handoffLimit: 2 });
    const renderedRed = (result.observations.match(/^- 🔴 /gm) ?? []).length;
    const renderedYellow = (result.observations.match(/^- 🟡 /gm) ?? []).length;

    expect(renderedRed).toBe(20);
    expect(renderedYellow).toBe(10);
    expect(result.observations).toContain('... and 10 more observations (use `clawvault context` to query)');

    fs.rmSync(vaultPath, { recursive: true, force: true });
  });
});
