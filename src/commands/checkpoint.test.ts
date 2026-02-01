import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkpoint, flush } from './checkpoint.js';

function makeTempVaultDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-test-'));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('checkpoint debounce', () => {
  it('coalesces rapid checkpoint calls into a single disk write', async () => {
    vi.useFakeTimers();

    const vaultPath = makeTempVaultDir();
    try {
      const checkpointPath = path.join(vaultPath, '.clawvault', 'last-checkpoint.json');

      await checkpoint({ vaultPath, workingOn: 'a' });
      await vi.advanceTimersByTimeAsync(500);
      await checkpoint({ vaultPath, workingOn: 'b' });
      await vi.advanceTimersByTimeAsync(500);
      await checkpoint({ vaultPath, workingOn: 'c' });

      // Timer should have been reset by the last call.
      await vi.advanceTimersByTimeAsync(999);
      expect(fs.existsSync(checkpointPath)).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(fs.existsSync(checkpointPath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
      expect(saved.workingOn).toBe('c');
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('flush writes immediately and cancels the pending debounce', async () => {
    vi.useFakeTimers();

    const vaultPath = makeTempVaultDir();
    try {
      const checkpointPath = path.join(vaultPath, '.clawvault', 'last-checkpoint.json');

      await checkpoint({ vaultPath, workingOn: 'soon' });
      const flushed = await flush();

      expect(flushed?.workingOn).toBe('soon');
      expect(fs.existsSync(checkpointPath)).toBe(true);
      const mtime = fs.statSync(checkpointPath).mtimeMs;

      await vi.advanceTimersByTimeAsync(2000);
      expect(fs.statSync(checkpointPath).mtimeMs).toBe(mtime);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});

