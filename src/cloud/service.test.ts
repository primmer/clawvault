import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { emitTrace, syncQueuedTraces } from './service.js';
import { updateCloudConfig } from './config.js';
import { readQueue } from './queue.js';

describe('cloud service', () => {
  let tempDir: string;
  const originalHome = process.env.CLAWVAULT_HOME;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-cloud-service-'));
    process.env.CLAWVAULT_HOME = tempDir;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalHome === undefined) {
      delete process.env.CLAWVAULT_HOME;
    } else {
      process.env.CLAWVAULT_HOME = originalHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('queues traces when cloud is not fully configured', async () => {
    const result = await emitTrace({ summary: 'Approved discount' });

    expect(result.trace.summary).toBe('Approved discount');
    expect(result.sync.skippedReason).toBe('cloud-not-configured');
    expect(readQueue().traces.length).toBe(1);
  });

  it('syncs queued traces and clears queue when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    updateCloudConfig({
      cloudApiKey: 'cvk_test_key',
      cloudVaultId: 'vault-abc',
      cloudApiUrl: 'http://localhost:4000'
    });

    await emitTrace({ summary: 'Decision one' }, false);
    await emitTrace({ summary: 'Decision two' }, false);
    expect(readQueue().traces.length).toBe(2);

    const result = await syncQueuedTraces({ all: true });
    expect(result.synced).toBe(2);
    expect(result.remaining).toBe(0);
    expect(readQueue().traces.length).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:4000/vaults/vault-abc/sync');
  });
});
