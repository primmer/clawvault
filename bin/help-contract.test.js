import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { registerCoreCommands } from './register-core-commands.js';
import { registerMaintenanceCommands } from './register-maintenance-commands.js';
import { registerQueryCommands } from './register-query-commands.js';
import { registerResilienceCommands } from './register-resilience-commands.js';
import { registerSessionLifecycleCommands } from './register-session-lifecycle-commands.js';
import { registerTemplateCommands } from './register-template-commands.js';
import { registerVaultOperationsCommands } from './register-vault-operations-commands.js';

const chalkStub = {
  cyan: (value) => value,
  green: (value) => value,
  red: (value) => value,
  dim: (value) => value,
  yellow: (value) => value,
  white: (value) => value
};

function stubResolveVaultPath(value) {
  return value ?? '/vault';
}

function buildProgram() {
  const program = new Command();
  registerCoreCommands(program, {
    chalk: chalkStub,
    path,
    fs,
    createVault: async () => ({ getCategories: () => [], getQmdRoot: () => '', getQmdCollection: () => '' }),
    getVault: async () => ({
      store: async () => ({}),
      capture: async () => ({}),
      find: async () => [],
      vsearch: async () => [],
      list: async () => [],
      get: async () => null,
      stats: async () => ({ tags: [], categories: {} }),
      sync: async () => ({ copied: [], deleted: [], unchanged: [], errors: [] }),
      reindex: async () => 0,
      remember: async () => ({ id: '' }),
      getQmdCollection: () => '',
      createHandoff: async () => ({ id: '', path: '' }),
      generateRecap: async () => ({}),
      formatRecap: () => ''
    }),
    runQmd: async () => {}
  });
  registerQueryCommands(program, {
    chalk: chalkStub,
    getVault: async () => ({ find: async () => [], vsearch: async () => [] }),
    resolveVaultPath: stubResolveVaultPath,
    QmdUnavailableError: class extends Error {},
    printQmdMissing: () => {}
  });
  registerVaultOperationsCommands(program, {
    chalk: chalkStub,
    fs,
    getVault: async () => ({ list: async () => [], get: async () => null, stats: async () => ({ tags: [], categories: {} }), sync: async () => ({ copied: [], deleted: [], unchanged: [], errors: [] }), reindex: async () => 0, remember: async () => ({ id: '' }), getQmdCollection: () => '' }),
    runQmd: async () => {},
    resolveVaultPath: stubResolveVaultPath,
    path
  });
  registerMaintenanceCommands(program, { chalk: chalkStub });
  registerResilienceCommands(program, {
    chalk: chalkStub,
    resolveVaultPath: stubResolveVaultPath
  });
  registerSessionLifecycleCommands(program, {
    chalk: chalkStub,
    resolveVaultPath: stubResolveVaultPath,
    QmdUnavailableError: class extends Error {},
    printQmdMissing: () => {},
    getVault: async () => ({
      createHandoff: async () => ({ id: '', path: '' }),
      getQmdCollection: () => '',
      generateRecap: async () => ({}),
      formatRecap: () => ''
    }),
    runQmd: async () => {}
  });
  registerTemplateCommands(program, { chalk: chalkStub });
  return program;
}

describe('CLI help contract', () => {
  it('includes expected high-level command surface', () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain('init');
    expect(help).toContain('context');
    expect(help).toContain('compat');
    expect(help).toContain('graph');
    expect(help).toContain('repair-session');
    expect(help).toContain('template');
  });

  it('documents context auto profile and compat strict options', () => {
    const program = buildProgram();
    const contextHelp = program.commands.find((command) => command.name() === 'context')?.helpInformation() ?? '';
    const compatHelp = program.commands.find((command) => command.name() === 'compat')?.helpInformation() ?? '';
    expect(contextHelp).toContain('--profile <profile>');
    expect(contextHelp).toContain('auto');
    expect(compatHelp).toContain('--strict');
  });
});
