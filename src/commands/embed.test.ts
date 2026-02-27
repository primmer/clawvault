import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { hasQmdMock, qmdEmbedMock, listQmdCollectionsMock } = vi.hoisted(() => ({
  hasQmdMock: vi.fn(),
  qmdEmbedMock: vi.fn(),
  listQmdCollectionsMock: vi.fn()
}));

vi.mock('../lib/search.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/search.js')>('../lib/search.js');
  return {
    ...actual,
    hasQmd: hasQmdMock,
    qmdEmbed: qmdEmbedMock
  };
});

vi.mock('../lib/qmd-collections.js', () => ({
  findCollectionByRoot: vi.fn().mockReturnValue(undefined),
  collectionExists: vi.fn().mockReturnValue(true),
  listQmdCollections: listQmdCollectionsMock,
  getFirstCollection: vi.fn().mockReturnValue(undefined)
}));

import { embedCommand } from './embed.js';
import { QmdUnavailableError } from '../lib/search.js';

const createdTempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdTempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.clearAllMocks();
  listQmdCollectionsMock.mockReset();
  listQmdCollectionsMock.mockReturnValue([]);
  while (createdTempDirs.length > 0) {
    const dir = createdTempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('embed command', () => {
  it('uses vault qmd collection from config', async () => {
    hasQmdMock.mockReturnValue(true);
    const vaultPath = makeTempDir('clawvault-embed-');
    const rootPath = path.join(vaultPath, 'notes-root');
    fs.mkdirSync(rootPath, { recursive: true });
    fs.writeFileSync(
      path.join(vaultPath, '.clawvault.json'),
      JSON.stringify({
        name: 'memory',
        version: '1.0.0',
        created: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        categories: [],
        documentCount: 0,
        qmdCollection: 'vault-collection',
        qmdRoot: './notes-root'
      }, null, 2)
    );

    const result = await embedCommand({ vaultPath, quiet: true });
    expect(qmdEmbedMock).toHaveBeenCalledWith('vault-collection');
    expect(result.qmdCollection).toBe('vault-collection');
    expect(result.qmdRoot).toBe(rootPath);
    expect(result.usedForce).toBe(false);
  });

  it('throws when qmd is unavailable', async () => {
    hasQmdMock.mockReturnValue(false);
    await expect(embedCommand({ vaultPath: '/tmp/memory', quiet: true })).rejects.toBeInstanceOf(QmdUnavailableError);
    expect(qmdEmbedMock).not.toHaveBeenCalled();
  });

  it('passes force option to qmd embed', async () => {
    hasQmdMock.mockReturnValue(true);
    const vaultPath = makeTempDir('clawvault-embed-force-');
    fs.writeFileSync(
      path.join(vaultPath, '.clawvault.json'),
      JSON.stringify({
        name: 'memory',
        version: '1.0.0',
        created: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        categories: [],
        documentCount: 0,
        qmdCollection: 'vault-collection',
        qmdRoot: vaultPath
      }, null, 2)
    );

    const result = await embedCommand({ vaultPath, quiet: true, force: true });
    expect(qmdEmbedMock).toHaveBeenCalledWith('vault-collection', undefined, { force: true });
    expect(result.usedForce).toBe(true);
  });

  it('retries with force when vectors are empty after embed', async () => {
    hasQmdMock.mockReturnValue(true);
    const vaultPath = makeTempDir('clawvault-embed-empty-vectors-');
    fs.writeFileSync(
      path.join(vaultPath, '.clawvault.json'),
      JSON.stringify({
        name: 'memory',
        version: '1.0.0',
        created: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        categories: [],
        documentCount: 0,
        qmdCollection: 'vault-collection',
        qmdRoot: vaultPath
      }, null, 2)
    );

    listQmdCollectionsMock
      .mockReturnValueOnce([{ name: 'vault-collection', uri: 'qmd://vault-collection', details: {}, files: 10, vectors: 0 }])
      .mockReturnValueOnce([{ name: 'vault-collection', uri: 'qmd://vault-collection', details: {}, files: 10, vectors: 10 }]);

    const result = await embedCommand({ vaultPath, quiet: true });
    expect(qmdEmbedMock).toHaveBeenNthCalledWith(1, 'vault-collection');
    expect(qmdEmbedMock).toHaveBeenNthCalledWith(2, 'vault-collection', undefined, { force: true });
    expect(result.rebuiltFromEmptyVectors).toBe(true);
    expect(result.vectors).toBe(10);
  });
});
