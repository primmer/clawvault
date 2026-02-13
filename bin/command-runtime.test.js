import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  spawnMock,
  resolveConfiguredVaultPathMock,
  clawvaultCtorMock,
  loadMock
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  resolveConfiguredVaultPathMock: vi.fn(),
  clawvaultCtorMock: vi.fn(),
  loadMock: vi.fn()
}));

vi.mock('child_process', () => ({
  spawn: spawnMock
}));

vi.mock('../dist/index.js', () => ({
  ClawVault: clawvaultCtorMock,
  resolveVaultPath: resolveConfiguredVaultPathMock,
  QmdUnavailableError: class QmdUnavailableError extends Error {},
  QMD_INSTALL_COMMAND: 'install-qmd'
}));

async function loadRuntimeModule() {
  vi.resetModules();
  return await import('./command-runtime.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  clawvaultCtorMock.mockImplementation(() => ({
    load: loadMock
  }));
});

describe('command runtime helpers', () => {
  it('delegates vault path resolution and loads vaults', async () => {
    resolveConfiguredVaultPathMock.mockReturnValue('/resolved/vault');
    loadMock.mockResolvedValue(undefined);
    const { getVault, resolveVaultPath } = await loadRuntimeModule();

    const resolved = resolveVaultPath('/explicit');
    expect(resolveConfiguredVaultPathMock).toHaveBeenCalledWith({ explicitPath: '/explicit' });
    expect(resolved).toBe('/resolved/vault');

    await getVault('/explicit');
    expect(clawvaultCtorMock).toHaveBeenCalledWith('/resolved/vault');
    expect(loadMock).toHaveBeenCalled();
  });

  it('maps qmd ENOENT failures to QmdUnavailableError', async () => {
    const { runQmd, QmdUnavailableError } = await loadRuntimeModule();
    spawnMock.mockImplementation(() => {
      const handlers = {};
      const proc = {
        on: (event, handler) => {
          handlers[event] = handler;
        }
      };
      queueMicrotask(() => {
        handlers.error?.({ code: 'ENOENT' });
      });
      return proc;
    });

    await expect(runQmd(['update'])).rejects.toBeInstanceOf(QmdUnavailableError);
  });
});
