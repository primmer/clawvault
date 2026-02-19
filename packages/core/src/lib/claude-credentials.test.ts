import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process and fs before importing the module under test
vi.mock('child_process', () => ({
  execFileSync: vi.fn()
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}));

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import {
  readClaudeCliCredentials,
  refreshClaudeOAuthToken,
  resolveClaudeOAuthToken,
  writeClaudeCliCredentials
} from './claude-credentials.js';

const mockExecFileSync = vi.mocked(execFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

const validCredJson = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'sk-ant-oat01-test-access',
    refreshToken: 'sk-ant-ort01-test-refresh',
    expiresAt: Date.now() + 60 * 60 * 1000 // 1 hour from now
  }
});

const expiredCredJson = JSON.stringify({
  claudeAiOauth: {
    accessToken: 'sk-ant-oat01-expired-access',
    refreshToken: 'sk-ant-ort01-test-refresh',
    expiresAt: Date.now() - 1000 // already expired
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileSync.mockImplementation(() => {
    throw new Error('keychain not available');
  });
  mockExistsSync.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('readClaudeCliCredentials', () => {
  it('returns credentials from keychain on macOS', () => {
    if (process.platform !== 'darwin') return;
    mockExecFileSync.mockReturnValue(validCredJson);

    const cred = readClaudeCliCredentials();
    expect(cred).not.toBeNull();
    expect(cred?.accessToken).toBe('sk-ant-oat01-test-access');
    expect(cred?.refreshToken).toBe('sk-ant-ort01-test-refresh');
  });

  it('falls back to credentials file when keychain fails', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('keychain failure'); });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(validCredJson);

    const cred = readClaudeCliCredentials({ homeDir: '/fake/home' });
    expect(cred).not.toBeNull();
    expect(cred?.accessToken).toBe('sk-ant-oat01-test-access');
  });

  it('returns null when credentials file does not exist', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('keychain failure'); });
    mockExistsSync.mockReturnValue(false);

    const cred = readClaudeCliCredentials({ homeDir: '/fake/home' });
    expect(cred).toBeNull();
  });

  it('returns null when credentials JSON is malformed', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('keychain failure'); });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid json');

    const cred = readClaudeCliCredentials({ homeDir: '/fake/home' });
    expect(cred).toBeNull();
  });

  it('returns null when claudeAiOauth block is missing', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('keychain failure'); });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ someOtherKey: 'value' }));

    const cred = readClaudeCliCredentials({ homeDir: '/fake/home' });
    expect(cred).toBeNull();
  });
});

describe('refreshClaudeOAuthToken', () => {
  it('exchanges refresh token for new credentials', async () => {
    const fetchImpl: typeof fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          access_token: 'sk-ant-oat01-new-access',
          refresh_token: 'sk-ant-ort01-new-refresh',
          expires_in: 3600
        })
      }) as Response;

    const result = await refreshClaudeOAuthToken('sk-ant-ort01-old-refresh', fetchImpl);
    expect(result.accessToken).toBe('sk-ant-oat01-new-access');
    expect(result.refreshToken).toBe('sk-ant-ort01-new-refresh');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('throws when the refresh endpoint returns an error', async () => {
    const fetchImpl: typeof fetch = async () =>
      ({
        ok: false,
        status: 401
      }) as Response;

    await expect(refreshClaudeOAuthToken('bad-token', fetchImpl)).rejects.toThrow(
      'OAuth token refresh failed (401)'
    );
  });
});

describe('writeClaudeCliCredentials', () => {
  it('writes to credentials file on non-Darwin or when keychain fails', () => {
    // Force keychain write to fail so we fall through to file write
    mockExecFileSync.mockImplementation(() => { throw new Error('keychain failure'); });

    const cred = {
      accessToken: 'sk-ant-oat01-write-test',
      refreshToken: 'sk-ant-ort01-write-test',
      expiresAt: Date.now() + 3600 * 1000
    };

    writeClaudeCliCredentials(cred, { homeDir: '/fake/home' });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/fake/home/.claude/.credentials.json',
      expect.stringContaining('sk-ant-oat01-write-test'),
      'utf8'
    );
  });
});

describe('resolveClaudeOAuthToken', () => {
  it('returns token directly when not expired', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('keychain failure'); });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(validCredJson);

    const token = await resolveClaudeOAuthToken({ homeDir: '/fake/home' });
    expect(token).toBe('sk-ant-oat01-test-access');
  });

  it('refreshes and returns new token when expired', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('keychain failure'); });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(expiredCredJson);

    const fetchImpl: typeof fetch = async () =>
      ({
        ok: true,
        json: async () => ({
          access_token: 'sk-ant-oat01-refreshed',
          refresh_token: 'sk-ant-ort01-new-refresh',
          expires_in: 3600
        })
      }) as Response;

    const token = await resolveClaudeOAuthToken({ homeDir: '/fake/home', fetchImpl });
    expect(token).toBe('sk-ant-oat01-refreshed');
  });

  it('returns old token when refresh fails (graceful degradation)', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('keychain failure'); });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(expiredCredJson);

    const fetchImpl: typeof fetch = async () =>
      ({
        ok: false,
        status: 500
      }) as Response;

    const token = await resolveClaudeOAuthToken({ homeDir: '/fake/home', fetchImpl });
    expect(token).toBe('sk-ant-oat01-expired-access');
  });

  it('returns null when no credentials exist', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('keychain failure'); });
    mockExistsSync.mockReturnValue(false);

    const token = await resolveClaudeOAuthToken({ homeDir: '/fake/home' });
    expect(token).toBeNull();
  });
});
