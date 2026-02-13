#!/usr/bin/env node

/**
 * ClawVault CLI 🐘
 * An elephant never forgets.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { createInterface } from 'readline/promises';
import { registerMaintenanceCommands } from './register-maintenance-commands.js';
import { registerResilienceCommands } from './register-resilience-commands.js';
import { registerSessionLifecycleCommands } from './register-session-lifecycle-commands.js';
import { registerTemplateCommands } from './register-template-commands.js';
import { registerVaultOperationsCommands } from './register-vault-operations-commands.js';
import {
  ClawVault,
  createVault,
  findVault,
  QmdUnavailableError,
  QMD_INSTALL_COMMAND
} from '../dist/index.js';

const program = new Command();

const CLI_VERSION = (() => {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgUrl, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// Helper to get vault (required for most commands)
// Checks: 1) explicit path, 2) CLAWVAULT_PATH env, 3) walk up from cwd
async function getVault(vaultPath) {
  // Explicit path takes priority
  if (vaultPath) {
    const vault = new ClawVault(path.resolve(vaultPath));
    await vault.load();
    return vault;
  }
  
  // Check environment variable
  const envPath = process.env.CLAWVAULT_PATH;
  if (envPath) {
    const vault = new ClawVault(path.resolve(envPath));
    await vault.load();
    return vault;
  }
  
  // Walk up from cwd
  const vault = await findVault();
  if (!vault) {
    console.error(chalk.red('Error: No ClawVault found. Run `clawvault init` first.'));
    console.log(chalk.dim('Tip: Set CLAWVAULT_PATH environment variable to your vault path'));
    process.exit(1);
  }
  return vault;
}

function resolveVaultPath(vaultPath) {
  if (vaultPath) {
    return path.resolve(vaultPath);
  }
  if (process.env.CLAWVAULT_PATH) {
    return path.resolve(process.env.CLAWVAULT_PATH);
  }
  let current = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(current, '.clawvault.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      console.error(chalk.red('Error: No ClawVault found. Run `clawvault init` first.'));
      console.log(chalk.dim('Tip: Set CLAWVAULT_PATH environment variable to your vault path'));
      process.exit(1);
    }
    current = parent;
  }
}

async function runQmd(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('qmd', args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`qmd exited with code ${code}`));
    });
    proc.on('error', (err) => {
      if (err?.code === 'ENOENT') {
        reject(new QmdUnavailableError());
      } else {
        reject(err);
      }
    });
  });
}

function printQmdMissing() {
  console.error(chalk.red('Error: ClawVault requires qmd.'));
  console.log(chalk.dim(`Install: ${QMD_INSTALL_COMMAND}`));
}

function parseBooleanInput(value, defaultValue = true) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (['y', 'yes', 'true', '1'].includes(normalized)) {
    return true;
  }
  if (['n', 'no', 'false', '0'].includes(normalized)) {
    return false;
  }
  return null;
}

program
  .name('clawvault')
  .description('🐘 An elephant never forgets. Structured memory for AI agents.')
  .version(CLI_VERSION);

// === INIT ===
program
  .command('init [path]')
  .description('Initialize a new ClawVault')
  .option('-n, --name <name>', 'Vault name')
  .option('--qmd', 'Set up qmd semantic search collection')
  .option('--qmd-collection <name>', 'qmd collection name (defaults to vault name)')
  .action(async (vaultPath, options) => {
    const targetPath = vaultPath || '.';
    console.log(chalk.cyan(`\n🐘 Initializing ClawVault at ${path.resolve(targetPath)}...\n`));
    
    try {
      const vault = await createVault(targetPath, {
        name: options.name || path.basename(path.resolve(targetPath)),
        qmdCollection: options.qmdCollection
      });
      
      console.log(chalk.green('✓ Vault created'));
      console.log(chalk.dim(`  Categories: ${vault.getCategories().join(', ')}`));

      // Always set up qmd collection (qmd is required)
      console.log(chalk.cyan('\nSetting up qmd collection...'));
      try {
        await runQmd([
          'collection',
          'add',
          vault.getQmdRoot(),
          '--name',
          vault.getQmdCollection(),
          '--mask',
          '**/*.md'
        ]);
        console.log(chalk.green('✓ qmd collection created'));
      } catch (err) {
        // Collection might already exist
        console.log(chalk.yellow('⚠ qmd collection may already exist'));
      }
      
      console.log(chalk.green('\n✅ ClawVault ready!\n'));
      console.log(chalk.dim('Next steps:'));
      console.log(chalk.dim('  clawvault store --category inbox --title "My note" --content "Hello world"'));
      console.log(chalk.dim('  clawvault search "hello"'));
      console.log();
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// === SETUP ===
program
  .command('setup')
  .description('Auto-discover and configure a ClawVault')
  .action(async () => {
    try {
      const { setupCommand } = await import('../dist/commands/setup.js');
      await setupCommand();
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// === STORE ===
program
  .command('store')
  .description('Store a new memory')
  .requiredOption('-c, --category <category>', 'Category (preferences, decisions, patterns, people, projects, goals, transcripts, inbox)')
  .requiredOption('-t, --title <title>', 'Document title')
  .option('--content <content>', 'Content body')
  .option('-f, --file <file>', 'Read content from file')
  .option('--stdin', 'Read content from stdin')
  .option('--overwrite', 'Overwrite if exists')
  .option('--no-index', 'Skip qmd index update (auto-updates by default)')
  .option('--embed', 'Also update qmd embeddings for vector search')
  .option('-v, --vault <path>', 'Vault path (default: find nearest)')
  .action(async (options) => {
    try {
      const vault = await getVault(options.vault);
      
      let content = options.content || '';
      
      if (options.file) {
        content = fs.readFileSync(options.file, 'utf-8');
      } else if (options.stdin) {
        content = fs.readFileSync(0, 'utf-8');
      }
      
      const doc = await vault.store({
        category: options.category,
        title: options.title,
        content,
        overwrite: options.overwrite
      });
      
      console.log(chalk.green(`✓ Stored: ${doc.id}`));
      console.log(chalk.dim(`  Path: ${doc.path}`));
      
      // Auto-update qmd index unless --no-index
      if (options.index !== false) {
        const collection = vault.getQmdCollection();
        await runQmd(collection ? ['update', '-c', collection] : ['update']);
        if (options.embed) {
          await runQmd(collection ? ['embed', '-c', collection] : ['embed']);
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// === CAPTURE ===
program
  .command('capture <note>')
  .description('Quick capture to inbox')
  .option('-t, --title <title>', 'Note title')
  .option('-v, --vault <path>', 'Vault path')
  .option('--no-index', 'Skip qmd index update')
  .action(async (note, options) => {
    try {
      const vault = await getVault(options.vault);
      const doc = await vault.capture(note, options.title);
      console.log(chalk.green(`✓ Captured: ${doc.id}`));
      
      // Auto-update qmd index unless --no-index
      if (options.index !== false) {
        const collection = vault.getQmdCollection();
        await runQmd(collection ? ['update', '-c', collection] : ['update']);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// === SEARCH ===
program
  .command('search <query>')
  .description('Search the vault via qmd (BM25)')
  .option('-n, --limit <n>', 'Max results', '10')
  .option('-c, --category <category>', 'Filter by category')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('--recent', 'Boost recent documents')
  .option('--full', 'Include full content in results')
  .option('-v, --vault <path>', 'Vault path')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    try {
      const vault = await getVault(options.vault);
      
      const results = await vault.find(query, {
        limit: parseInt(options.limit),
        category: options.category,
        tags: options.tags?.split(',').map(t => t.trim()),
        fullContent: options.full,
        temporalBoost: options.recent
      });
      
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      
      if (results.length === 0) {
        console.log(chalk.yellow('No results found.'));
        return;
      }
      
      console.log(chalk.cyan(`\n🔍 Found ${results.length} result(s) for "${query}":\n`));
      
      for (const result of results) {
        const scoreBar = '█'.repeat(Math.round(result.score * 10)).padEnd(10, '░');
        console.log(chalk.green(`📄 ${result.document.title}`));
        console.log(chalk.dim(`   ${result.document.category}/${result.document.id.split('/').pop()}`));
        console.log(chalk.dim(`   Score: ${scoreBar} ${(result.score * 100).toFixed(0)}%`));
        if (result.snippet) {
          console.log(chalk.white(`   ${result.snippet.split('\n')[0].slice(0, 80)}...`));
        }
        console.log();
      }
    } catch (err) {
      if (err instanceof QmdUnavailableError) {
        printQmdMissing();
        process.exit(1);
      }
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// === VSEARCH (qmd semantic search) ===
program
  .command('vsearch <query>')
  .description('Semantic search via qmd (requires qmd installed)')
  .option('-n, --limit <n>', 'Max results', '5')
  .option('-c, --category <category>', 'Filter by category')
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('--recent', 'Boost recent documents')
  .option('--full', 'Include full content in results')
  .option('-v, --vault <path>', 'Vault path')
  .option('--json', 'Output as JSON')
  .action(async (query, options) => {
    try {
      const vault = await getVault(options.vault);
      
      const results = await vault.vsearch(query, {
        limit: parseInt(options.limit),
        category: options.category,
        tags: options.tags?.split(',').map(t => t.trim()),
        fullContent: options.full,
        temporalBoost: options.recent
      });
      
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      
      if (results.length === 0) {
        console.log(chalk.yellow('No results found.'));
        return;
      }
      
      console.log(chalk.cyan(`\n🧠 Found ${results.length} result(s) for "${query}":\n`));
      
      for (const result of results) {
        const scoreBar = '█'.repeat(Math.round(result.score * 10)).padEnd(10, '░');
        console.log(chalk.green(`📄 ${result.document.title}`));
        console.log(chalk.dim(`   ${result.document.category}/${result.document.id.split('/').pop()}`));
        console.log(chalk.dim(`   Score: ${scoreBar} ${(result.score * 100).toFixed(0)}%`));
        if (result.snippet) {
          console.log(chalk.white(`   ${result.snippet.split('\n')[0].slice(0, 80)}...`));
        }
        console.log();
      }
    } catch (err) {
      if (err instanceof QmdUnavailableError) {
        printQmdMissing();
        process.exit(1);
      }
      console.error(chalk.red(`Error: ${err.message}`));
      console.log(chalk.dim(`\nTip: Install qmd: ${QMD_INSTALL_COMMAND}`));
      process.exit(1);
    }
  });

// === CONTEXT ===
program
  .command('context <task>')
  .description('Generate task-relevant context for prompt injection')
  .option('-n, --limit <n>', 'Max results', '5')
  .option('--format <format>', 'Output format (markdown|json)', 'markdown')
  .option('--recent', 'Boost recent documents (enabled by default)', true)
  .option('--include-observations', 'Include observation memories in output', true)
  .option('--budget <number>', 'Optional token budget for assembled context')
  .option('--profile <profile>', 'Context profile (default|planning|incident|handoff)', 'default')
  .option('-v, --vault <path>', 'Vault path')
  .action(async (task, options) => {
    try {
      const vaultPath = resolveVaultPath(options.vault);
      const format = options.format === 'json' ? 'json' : 'markdown';
      const parsedBudget = options.budget ? Number.parseInt(options.budget, 10) : undefined;
      if (options.budget && (!Number.isFinite(parsedBudget) || parsedBudget <= 0)) {
        throw new Error(`Invalid --budget value: ${options.budget}`);
      }

      const { contextCommand } = await import('../dist/commands/context.js');
      await contextCommand(task, {
        vaultPath,
        limit: parseInt(options.limit),
        format,
        recent: options.recent,
        includeObservations: options.includeObservations,
        budget: parsedBudget,
        profile: options.profile
      });
    } catch (err) {
      if (err instanceof QmdUnavailableError) {
        printQmdMissing();
        process.exit(1);
      }
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// === OBSERVE ===
program
  .command('observe')
  .description('Observe session files and build observational memory')
  .option('--watch <path>', 'Watch session file or directory')
  .option('--threshold <n>', 'Compression token threshold', '30000')
  .option('--reflect-threshold <n>', 'Reflection token threshold', '40000')
  .option('--model <model>', 'LLM model override')
  .option('--compress <file>', 'One-shot compression for a conversation file')
  .option('--daemon', 'Run in detached background mode')
  .option('-v, --vault <path>', 'Vault path')
  .action(async (options) => {
    try {
      const { observeCommand } = await import('../dist/commands/observe.js');
      const threshold = Number.parseInt(options.threshold, 10);
      const reflectThreshold = Number.parseInt(options.reflectThreshold, 10);
      if (Number.isNaN(threshold) || threshold <= 0) {
        throw new Error(`Invalid --threshold value: ${options.threshold}`);
      }
      if (Number.isNaN(reflectThreshold) || reflectThreshold <= 0) {
        throw new Error(`Invalid --reflect-threshold value: ${options.reflectThreshold}`);
      }

      await observeCommand({
        watch: options.watch,
        threshold,
        reflectThreshold,
        model: options.model,
        compress: options.compress,
        daemon: options.daemon,
        vaultPath: resolveVaultPath(options.vault)
      });
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// === SESSION-RECAP ===
program
  .command('session-recap <sessionKey>')
  .description('Generate recap from a specific OpenClaw session transcript')
  .option('-n, --limit <n>', 'Number of messages to include', '15')
  .option('--format <format>', 'Output format (markdown|json)', 'markdown')
  .option('-a, --agent <id>', 'Agent ID (default: OPENCLAW_AGENT_ID or clawdious)')
  .action(async (sessionKey, options) => {
    try {
      const { sessionRecapCommand } = await import('../dist/commands/session-recap.js');
      const format = options.format === 'json' ? 'json' : 'markdown';
      const parsedLimit = Number.parseInt(options.limit, 10);
      await sessionRecapCommand(sessionKey, {
        limit: Number.isNaN(parsedLimit) ? 15 : parsedLimit,
        format,
        agentId: options.agent
      });
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

registerSessionLifecycleCommands(program, {
  chalk,
  resolveVaultPath,
  QmdUnavailableError,
  printQmdMissing,
  getVault,
  runQmd
});

registerTemplateCommands(program, { chalk });
registerMaintenanceCommands(program, { chalk });
registerResilienceCommands(program, { chalk, resolveVaultPath });
registerVaultOperationsCommands(program, {
  chalk,
  fs,
  getVault,
  runQmd,
  resolveVaultPath,
  path,
  QmdUnavailableError,
  printQmdMissing
});

// Parse and run
program.parse();