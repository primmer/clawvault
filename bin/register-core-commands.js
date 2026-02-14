/**
 * Core vault lifecycle and write command registrations.
 */

export function registerCoreCommands(
  program,
  { chalk, path, fs, createVault, getVault, runQmd }
) {
  // === INIT ===
  program
    .command('init [path]')
    .description('Initialize a new ClawVault')
    .option('-n, --name <name>', 'Vault name')
    .option('--qmd', 'Set up qmd semantic search collection')
    .option('--qmd-collection <name>', 'qmd collection name (defaults to vault name)')
    .option('--no-bases', 'Skip Obsidian Bases file generation')
    .option('--no-tasks', 'Skip tasks/ and backlog/ directories')
    .option('--no-graph', 'Skip initial graph build')
    .option('--categories <list>', 'Comma-separated list of custom categories to create')
    .option('--canvas <template>', 'Generate a canvas dashboard on init (default, brain, project-board, sprint)')
    .option('--theme <style>', 'Graph color theme to apply (brainmeld, minimal, none)', 'none')
    .option('--minimal', 'Create minimal vault (memory categories only, no tasks/bases/graph)')
    .action(async (vaultPath, options) => {
      const targetPath = vaultPath || '.';
      console.log(chalk.cyan(`\n🐘 Initializing ClawVault at ${path.resolve(targetPath)}...\n`));

      try {
        const vault = await createVault(targetPath, {
          name: options.name || path.basename(path.resolve(targetPath)),
          qmdCollection: options.qmdCollection
        });

        const categories = vault.getCategories();
        const memoryCategories = categories.filter(c => !['templates', 'tasks', 'backlog'].includes(c));
        const workCategories = categories.filter(c => ['tasks', 'backlog'].includes(c));

        console.log(chalk.green('✓ Vault created'));
        console.log(chalk.dim(`  Memory:  ${memoryCategories.join(', ')}`));
        console.log(chalk.dim(`  Work:    ${workCategories.join(', ')}`));
        console.log(chalk.dim(`  Ledger:  ledger/raw, ledger/observations, ledger/reflections`));

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
        } catch {
          console.log(chalk.yellow('⚠ qmd collection may already exist'));
        }

        console.log(chalk.green('\n✅ ClawVault ready!\n'));
        console.log('  ' + chalk.bold('Try these:'));
        console.log(chalk.dim('  clawvault capture "my first thought"     # quick capture'));
        console.log(chalk.dim('  clawvault graph                          # see your knowledge graph'));
        console.log(chalk.dim('  clawvault context "topic"                # graph-aware context'));
        console.log(chalk.dim('  clawvault checkpoint --working-on "task"  # save progress'));
        console.log();
        console.log(chalk.dim('  Full docs: https://docs.clawvault.dev'));
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
    .option('--graph-colors', 'Set up graph color scheme for Obsidian')
    .option('--no-graph-colors', 'Skip graph color configuration')
    .option('--bases', 'Generate Obsidian Bases views for task management')
    .option('--no-bases', 'Skip Bases file generation')
    .option('--canvas [template]', 'Generate canvas dashboard (default, brain, project-board, sprint)')
    .option('--no-canvas', 'Skip canvas generation')
    .option('--theme <style>', 'Graph color theme (brainmeld, minimal, none)', 'brainmeld')
    .option('--force', 'Overwrite existing configuration files')
    .option('-v, --vault <path>', 'Vault path')
    .action(async (options) => {
      try {
        const { setupCommand } = await import('../dist/commands/setup.js');
        await setupCommand({
          graphColors: options.graphColors,
          bases: options.bases,
          canvas: options.canvas,
          theme: options.theme,
          force: options.force,
          vault: options.vault
        });
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

        if (options.index !== false) {
          const collection = vault.getQmdCollection();
          await runQmd(collection ? ['update', '-c', collection] : ['update']);
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });
}
