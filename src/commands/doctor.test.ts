import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {
  execFileSyncMock,
  hasQmdMock,
  qmdUpdateMock,
  qmdEmbedMock,
  scanVaultLinksMock
} = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  hasQmdMock: vi.fn(),
  qmdUpdateMock: vi.fn(),
  qmdEmbedMock: vi.fn(),
  scanVaultLinksMock: vi.fn()
}));

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock
}));

vi.mock('../lib/search.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/search.js')>('../lib/search.js');
  return {
    ...actual,
    hasQmd: hasQmdMock,
    qmdUpdate: qmdUpdateMock,
    qmdEmbed: qmdEmbedMock
  };
});

vi.mock('../lib/backlinks.js', () => ({
  scanVaultLinks: scanVaultLinksMock
}));

import { doctor } from './doctor.js';

const createdTempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdTempDirs.push(dir);
  return dir;
}

function writeVaultConfig(vaultPath: string, overrides: { qmdCollection?: string; qmdRoot?: string } = {}): void {
  const payload = {
    name: 'vault',
    version: '1.0.0',
    created: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    categories: ['inbox'],
    documentCount: 0,
    qmdCollection: overrides.qmdCollection ?? 'vault',
    qmdRoot: overrides.qmdRoot ?? vaultPath
  };
  fs.writeFileSync(path.join(vaultPath, '.clawvault.json'), JSON.stringify(payload, null, 2));
}

function writeDefaultMarkdown(vaultPath: string): void {
  fs.mkdirSync(path.join(vaultPath, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, 'inbox', 'a.md'), '# A');
  fs.writeFileSync(path.join(vaultPath, 'inbox', 'b.md'), '# B');
}

function mockCollectionList(raw: string): void {
  execFileSyncMock.mockImplementation((command: string, args: string[]) => {
    if (command === 'qmd' && args[0] === 'collection' && args[1] === 'list') {
      return raw;
    }
    if (command === 'qmd' && args[0] === 'collection' && (args[1] === 'remove' || args[1] === 'rm')) {
      return '';
    }
    if (command === 'git') {
      return '';
    }
    return '';
  });
}

afterEach(() => {
  vi.clearAllMocks();
  while (createdTempDirs.length > 0) {
    const dir = createdTempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('doctor', () => {
  it('reports all seven checks and flags stale/dirty conditions', async () => {
    hasQmdMock.mockReturnValue(true);
    scanVaultLinksMock.mockReturnValue({
      backlinks: new Map(),
      orphans: [{ source: 'inbox/a', target: 'missing-note' }],
      linkCount: 1
    });

    const vaultPath = makeTempDir('clawvault-doctor-');
    writeVaultConfig(vaultPath);
    writeDefaultMarkdown(vaultPath);
    fs.mkdirSync(path.join(vaultPath, '.git'), { recursive: true });

    const clawvaultDir = path.join(vaultPath, '.clawvault');
    fs.mkdirSync(clawvaultDir, { recursive: true });
    const staleTimestamp = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(clawvaultDir, 'observe-cursors.json'),
      JSON.stringify({
        main: {
          sessionKey: 'agent:main',
          lastObservedAt: staleTimestamp,
          lastObservedOffset: 42,
          lastFileSize: 99
        }
      }, null, 2)
    );
    fs.writeFileSync(
      path.join(clawvaultDir, 'last-checkpoint.json'),
      JSON.stringify({ timestamp: staleTimestamp }, null, 2)
    );

    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === 'qmd' && args[0] === 'collection' && args[1] === 'list') {
        return `Collections (2):

vault (qmd://vault/)
  Root: ${vaultPath}
  Pattern: **/*.md
  Files: 1
  Vectors: 0
  Pending: 1
dead (qmd://dead/)
  Root: /tmp/clawvault-test-dead-collection
  Pattern: **/*.md
  Files: 10
  Vectors: 10
`;
      }
      if (command === 'git') {
        return ' M inbox/a.md\n?? inbox/c.md\n';
      }
      return '';
    });

    const report = await doctor({ vaultPath });
    expect(report.checks).toHaveLength(7);

    const checkById = new Map(report.checks.map((check) => [check.id, check]));
    expect(checkById.get('stale_qmd_index')?.status).toBe('warn');
    expect(checkById.get('pending_embeddings')?.status).toBe('warn');
    expect(checkById.get('dead_qmd_collections')?.status).toBe('error');
    expect(checkById.get('stale_observer')?.status).toBe('warn');
    expect(checkById.get('stale_checkpoint')?.status).toBe('warn');
    expect(checkById.get('orphan_wiki_links')?.status).toBe('warn');
    expect(checkById.get('dirty_git')?.status).toBe('warn');
    expect(report.warnings).toBe(6);
    expect(report.errors).toBe(1);
  });

  it('applies fixes for stale index, pending embeddings, and dead collections', async () => {
    hasQmdMock.mockReturnValue(true);
    scanVaultLinksMock.mockReturnValue({
      backlinks: new Map(),
      orphans: [],
      linkCount: 0
    });

    const vaultPath = makeTempDir('clawvault-doctor-fix-');
    writeVaultConfig(vaultPath);
    writeDefaultMarkdown(vaultPath);

    mockCollectionList(`Collections (2):

vault (qmd://vault/)
  Root: ${vaultPath}
  Files: 1
  Vectors: 0
  Pending: 1
dead (qmd://dead/)
  Root: /tmp/clawvault-test-dead
  Files: 3
`);

    const report = await doctor({ vaultPath, fix: true });

    expect(qmdUpdateMock).toHaveBeenCalledWith('vault');
    expect(qmdEmbedMock).toHaveBeenCalledWith('vault');
    expect(
      execFileSyncMock.mock.calls.some(
        ([command, args]) =>
          command === 'qmd'
          && args[0] === 'collection'
          && (args[1] === 'remove' || args[1] === 'rm')
          && args[2] === 'dead'
      )
    ).toBe(true);

    const checkById = new Map(report.checks.map((check) => [check.id, check]));
    expect(checkById.get('stale_qmd_index')?.fixed).toBe(true);
    expect(checkById.get('pending_embeddings')?.fixed).toBe(true);
    expect(checkById.get('dead_qmd_collections')?.fixed).toBe(true);
  });

  it('still reports seven checks when qmd is unavailable', async () => {
    hasQmdMock.mockReturnValue(false);
    scanVaultLinksMock.mockReturnValue({
      backlinks: new Map(),
      orphans: [],
      linkCount: 0
    });

    const vaultPath = makeTempDir('clawvault-doctor-noqmd-');
    writeVaultConfig(vaultPath);
    writeDefaultMarkdown(vaultPath);

    const report = await doctor({ vaultPath });
    expect(report.checks).toHaveLength(7);

    const qmdChecks = report.checks.filter((check) =>
      check.id === 'stale_qmd_index'
      || check.id === 'pending_embeddings'
      || check.id === 'dead_qmd_collections'
    );
    expect(qmdChecks.every((check) => check.status === 'error')).toBe(true);
  });
});
