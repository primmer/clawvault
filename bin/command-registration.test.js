import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { registerCoreCommands } from './register-core-commands.js';
import { registerQueryCommands } from './register-query-commands.js';
import { registerVaultOperationsCommands } from './register-vault-operations-commands.js';

function listCommandNames(program) {
  return program.commands.map((command) => command.name()).sort((a, b) => a.localeCompare(b));
}

describe('CLI command registration modules', () => {
  it('registers core lifecycle commands', () => {
    const program = new Command();
    registerCoreCommands(program, {
      chalk: { cyan: (s) => s, green: (s) => s, red: (s) => s, dim: (s) => s, yellow: (s) => s },
      path,
      fs,
      createVault: async () => ({ getCategories: () => [], getQmdRoot: () => '', getQmdCollection: () => '' }),
      getVault: async () => ({ store: async () => ({}), capture: async () => ({}) }),
      runQmd: async () => {}
    });

    const names = listCommandNames(program);
    expect(names).toEqual(expect.arrayContaining(['init', 'setup', 'store', 'capture']));
  });

  it('registers query commands with profile option', () => {
    const program = new Command();
    registerQueryCommands(program, {
      chalk: { cyan: (s) => s, green: (s) => s, red: (s) => s, dim: (s) => s, yellow: (s) => s, white: (s) => s },
      getVault: async () => ({ find: async () => [], vsearch: async () => [] }),
      resolveVaultPath: (value) => value ?? '/vault',
      QmdUnavailableError: class extends Error {},
      printQmdMissing: () => {}
    });

    const names = listCommandNames(program);
    expect(names).toEqual(expect.arrayContaining(['search', 'vsearch', 'context', 'observe', 'session-recap']));

    const contextCommand = program.commands.find((command) => command.name() === 'context');
    const profileOption = contextCommand?.options.find((option) => option.flags.includes('--profile <profile>'));
    expect(profileOption?.description).toContain('auto');
  });

  it('registers vault operation commands', () => {
    const program = new Command();
    registerVaultOperationsCommands(program, {
      chalk: { cyan: (s) => s, green: (s) => s, red: (s) => s, dim: (s) => s, yellow: (s) => s },
      fs,
      getVault: async () => ({ list: async () => [], get: async () => null, stats: async () => ({ tags: [], categories: {} }), sync: async () => ({ copied: [], deleted: [], unchanged: [], errors: [] }), reindex: async () => 0, remember: async () => ({ id: '' }), getQmdCollection: () => '' }),
      runQmd: async () => {},
      resolveVaultPath: (value) => value ?? '/vault',
      path
    });

    const names = listCommandNames(program);
    expect(names).toEqual(expect.arrayContaining([
      'list',
      'get',
      'stats',
      'sync',
      'reindex',
      'remember',
      'shell-init',
      'dashboard'
    ]));
  });
});
