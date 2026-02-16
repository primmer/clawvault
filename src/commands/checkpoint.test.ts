import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn()
}));

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock
}));

const envSnapshot = {
  OPENCLAW_SESSION_KEY: process.env.OPENCLAW_SESSION_KEY,
  OPENCLAW_MODEL: process.env.OPENCLAW_MODEL,
  OPENCLAW_TOKEN_ESTIMATE: process.env.OPENCLAW_TOKEN_ESTIMATE,
  OPENCLAW_CONTEXT_TOKENS: process.env.OPENCLAW_CONTEXT_TOKENS
};

function makeTempVaultDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-test-'));
}

function listCheckpointHistoryFiles(vaultPath: string): string[] {
  const historyDir = path.join(vaultPath, '.clawvault', 'checkpoints');
  if (!fs.existsSync(historyDir)) {
    return [];
  }
  return fs.readdirSync(historyDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort();
}

async function loadCheckpointModule() {
  vi.resetModules();
  return await import('./checkpoint.js');
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  process.env.OPENCLAW_SESSION_KEY = envSnapshot.OPENCLAW_SESSION_KEY;
  process.env.OPENCLAW_MODEL = envSnapshot.OPENCLAW_MODEL;
  process.env.OPENCLAW_TOKEN_ESTIMATE = envSnapshot.OPENCLAW_TOKEN_ESTIMATE;
  process.env.OPENCLAW_CONTEXT_TOKENS = envSnapshot.OPENCLAW_CONTEXT_TOKENS;
});

describe('checkpoint debounce', () => {
  it('writes each flushed checkpoint to history with timestamped filenames', async () => {
    vi.useFakeTimers();
    const { checkpoint, flush } = await loadCheckpointModule();

    const vaultPath = makeTempVaultDir();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      await checkpoint({ vaultPath, workingOn: 'first' });
      await flush();

      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      await checkpoint({ vaultPath, workingOn: 'second' });
      await flush();

      expect(listCheckpointHistoryFiles(vaultPath)).toEqual([
        '2026-01-01T00-00-00-000Z.json',
        '2026-01-01T00-00-01-000Z.json'
      ]);

      const latest = JSON.parse(
        fs.readFileSync(path.join(vaultPath, '.clawvault', 'last-checkpoint.json'), 'utf-8')
      );
      expect(latest.workingOn).toBe('second');
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('coalesces rapid checkpoint calls into a single disk write', async () => {
    vi.useFakeTimers();
    const { checkpoint } = await loadCheckpointModule();

    const vaultPath = makeTempVaultDir();
    try {
      const checkpointPath = path.join(vaultPath, '.clawvault', 'last-checkpoint.json');
      const historyDir = path.join(vaultPath, '.clawvault', 'checkpoints');

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
      expect(fs.existsSync(historyDir)).toBe(true);
      const historyFiles = fs.readdirSync(historyDir).filter((entry) => entry.endsWith('.json'));
      expect(historyFiles.length).toBe(1);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('flush writes immediately and cancels the pending debounce', async () => {
    vi.useFakeTimers();
    const { checkpoint, flush } = await loadCheckpointModule();

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

  it('prunes checkpoints older than 7 days when count exceeds 50', async () => {
    vi.useFakeTimers();
    const { checkpoint, flush } = await loadCheckpointModule();

    const vaultPath = makeTempVaultDir();
    try {
      const baseTime = new Date('2026-01-01T00:00:00.000Z');
      for (let index = 0; index < 60; index += 1) {
        vi.setSystemTime(new Date(baseTime.getTime() + index * 1000));
        await checkpoint({ vaultPath, workingOn: `old-${index}` });
        await flush();
      }

      vi.setSystemTime(new Date(baseTime.getTime() + 10 * 24 * 60 * 60 * 1000));
      await checkpoint({ vaultPath, workingOn: 'fresh' });
      await flush();

      const historyDir = path.join(vaultPath, '.clawvault', 'checkpoints');
      const retainedRecords = fs.readdirSync(historyDir)
        .filter((entry) => entry.endsWith('.json'))
        .map((fileName) => JSON.parse(fs.readFileSync(path.join(historyDir, fileName), 'utf-8')));

      expect(retainedRecords).toHaveLength(50);
      expect(retainedRecords.some((record) => record.workingOn === 'fresh')).toBe(true);
      expect(retainedRecords.some((record) => record.workingOn === 'old-0')).toBe(false);
      expect(retainedRecords.some((record) => record.workingOn === 'old-59')).toBe(true);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('keeps more than 50 checkpoints when they are within 7 days', async () => {
    vi.useFakeTimers();
    const { checkpoint, flush } = await loadCheckpointModule();

    const vaultPath = makeTempVaultDir();
    try {
      const baseTime = new Date('2026-01-01T00:00:00.000Z');
      for (let index = 0; index < 55; index += 1) {
        vi.setSystemTime(new Date(baseTime.getTime() + index * 60 * 1000));
        await checkpoint({ vaultPath, workingOn: `recent-${index}` });
        await flush();
      }

      expect(listCheckpointHistoryFiles(vaultPath)).toHaveLength(55);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('writes urgent checkpoints immediately and triggers a wake', async () => {
    execFileSyncMock.mockReturnValue('');
    const { checkpoint, checkDirtyDeath, clearDirtyFlag } = await loadCheckpointModule();

    const vaultPath = makeTempVaultDir();
    try {
      const checkpointPath = path.join(vaultPath, '.clawvault', 'last-checkpoint.json');
      const flagPath = path.join(vaultPath, '.clawvault', 'dirty-death.flag');
      const historyDir = path.join(vaultPath, '.clawvault', 'checkpoints');

      const data = await checkpoint({ vaultPath, workingOn: 'urgent', urgent: true });

      expect(data.urgent).toBe(true);
      expect(fs.existsSync(checkpointPath)).toBe(true);
      expect(fs.existsSync(flagPath)).toBe(true);
      expect(fs.existsSync(historyDir)).toBe(true);
      expect(execFileSyncMock).toHaveBeenCalledWith(
        'openclaw',
        expect.arrayContaining(['gateway', 'wake', '--mode', 'now']),
        expect.objectContaining({ stdio: 'inherit' })
      );

      const deathInfo = await checkDirtyDeath(vaultPath);
      expect(deathInfo.died).toBe(true);
      expect(deathInfo.deathTime).toBeTruthy();

      await clearDirtyFlag(vaultPath);
      expect(fs.existsSync(flagPath)).toBe(false);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('uses env session details and persists startedAt', async () => {
    const { setSessionState, checkpoint } = await loadCheckpointModule();

    const vaultPath = makeTempVaultDir();
    try {
      await setSessionState(vaultPath, {
        sessionId: 'session-1',
        sessionKey: 'file-key',
        model: 'file-model',
        tokenEstimate: 123
      });

      const sessionPath = path.join(vaultPath, '.clawvault', 'session-state.json');
      const savedState = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      expect(savedState.startedAt).toBeTruthy();

      process.env.OPENCLAW_SESSION_KEY = 'env-key';
      process.env.OPENCLAW_MODEL = 'env-model';
      process.env.OPENCLAW_TOKEN_ESTIMATE = '456';

      const data = await checkpoint({ vaultPath, workingOn: 'work' });
      expect(data.sessionKey).toBe('env-key');
      expect(data.model).toBe('env-model');
      expect(data.tokenEstimate).toBe(456);
      expect(data.sessionStartedAt).toBe(savedState.startedAt);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('populates recover --list history from checkpoint writes', async () => {
    vi.useFakeTimers();
    const { checkpoint, flush } = await loadCheckpointModule();
    const { listCheckpoints } = await import('./recover.js');

    const vaultPath = makeTempVaultDir();
    try {
      vi.setSystemTime(new Date('2026-02-01T10:00:00.000Z'));
      await checkpoint({ vaultPath, workingOn: 'first', focus: 'setup' });
      await flush();

      vi.setSystemTime(new Date('2026-02-01T10:00:05.000Z'));
      await checkpoint({ vaultPath, workingOn: 'second', focus: 'tests' });
      await flush();

      const listed = listCheckpoints(vaultPath);
      expect(listed).toHaveLength(2);
      expect(listed[0].workingOn).toBe('second');
      expect(listed[1].workingOn).toBe('first');
      expect(listed[0].filePath).toContain(path.join('.clawvault', 'checkpoints'));
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});

