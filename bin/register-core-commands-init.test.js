import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCoreCommands } from './register-core-commands.js';
import { chalkStub, createGetVaultStub } from './test-helpers/cli-command-fixtures.js';

describe('registerCoreCommands init flags', () => {
  const originalArgv = process.argv;
  let tempDir;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-init-flags-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('maps --no-tasks and --no-graph into createVault init flags', async () => {
    const createVault = vi.fn().mockResolvedValue({
      getCategories: () => ['rules'],
      getQmdRoot: () => tempDir,
      getQmdCollection: () => 'wg',
    });
    const runQmd = vi.fn().mockResolvedValue(undefined);

    const program = new Command();
    registerCoreCommands(program, {
      chalk: chalkStub,
      path,
      fs,
      createVault,
      getVault: createGetVaultStub(),
      runQmd,
    });

    await program.parseAsync(['init', tempDir, '--no-tasks', '--no-graph', '--no-bases'], { from: 'user' });

    expect(createVault).toHaveBeenCalledTimes(1);
    expect(createVault.mock.calls[0][2]).toMatchObject({
      skipBases: true,
      skipTasks: true,
      skipGraph: true,
    });
  });

  it('maps --minimal to all skip flags', async () => {
    const createVault = vi.fn().mockResolvedValue({
      getCategories: () => ['rules'],
      getQmdRoot: () => tempDir,
      getQmdCollection: () => 'wg',
    });
    const runQmd = vi.fn().mockResolvedValue(undefined);

    const program = new Command();
    registerCoreCommands(program, {
      chalk: chalkStub,
      path,
      fs,
      createVault,
      getVault: createGetVaultStub(),
      runQmd,
    });

    await program.parseAsync(['init', tempDir, '--minimal'], { from: 'user' });

    expect(createVault).toHaveBeenCalledTimes(1);
    expect(createVault.mock.calls[0][2]).toMatchObject({
      skipBases: true,
      skipTasks: true,
      skipGraph: true,
    });
  });
});
