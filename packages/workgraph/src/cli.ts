import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import * as workgraph from './index.js';

type JsonCapableOptions = {
  json?: boolean;
  workspace?: string;
  vault?: string;
};

const DEFAULT_ACTOR =
  process.env.WORKGRAPH_AGENT ||
  process.env.CLAWVAULT_AGENT ||
  process.env.USER ||
  'anonymous';

const CLI_VERSION = (() => {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgUrl, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const program = new Command();
program
  .name('workgraph')
  .description('Agent-first workgraph workspace for multi-agent collaboration.')
  .version(CLI_VERSION);

program.showHelpAfterError();

addWorkspaceOption(
  program
    .command('init [path]')
    .description('Initialize a pure workgraph workspace (no memory category scaffolding)')
    .option('-n, --name <name>', 'Workspace name')
    .option('--no-type-dirs', 'Do not pre-create built-in type directories')
    .option('--no-readme', 'Do not create README.md')
    .option('--json', 'Emit structured JSON output')
).action((targetPath, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = path.resolve(targetPath || resolveWorkspacePath(opts));
      const result = workgraph.workspace.initWorkspace(workspacePath, {
        name: opts.name,
        createTypeDirs: opts.typeDirs,
        createReadme: opts.readme,
      });
      return result;
    },
    (result) => [
      `Initialized workgraph workspace: ${result.workspacePath}`,
      `Seeded types: ${result.seededTypes.join(', ')}`,
      `Config: ${result.configPath}`,
    ]
  )
);

// ============================================================================
// thread
// ============================================================================

const threadCmd = program
  .command('thread')
  .description('Coordinate work through claimable threads');

addWorkspaceOption(
  threadCmd
    .command('create <title>')
    .description('Create a new thread')
    .requiredOption('-g, --goal <goal>', 'What success looks like')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('-p, --priority <level>', 'urgent | high | medium | low', 'medium')
    .option('--deps <paths>', 'Comma-separated dependency thread paths')
    .option('--parent <path>', 'Parent thread path')
    .option('--space <spaceRef>', 'Optional space ref (e.g. spaces/backend.md)')
    .option('--context <refs>', 'Comma-separated workspace doc refs for context')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--json', 'Emit structured JSON output')
).action((title, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      return {
        thread: workgraph.thread.createThread(workspacePath, title, opts.goal, opts.actor, {
          priority: opts.priority,
          deps: csv(opts.deps),
          parent: opts.parent,
          space: opts.space,
          context_refs: csv(opts.context),
          tags: csv(opts.tags),
        }),
      };
    },
    (result) => [
      `Created thread: ${result.thread.path}`,
      `Status: ${String(result.thread.fields.status)}`,
      `Priority: ${String(result.thread.fields.priority)}`,
    ]
  )
);

addWorkspaceOption(
  threadCmd
    .command('list')
    .description('List threads (optionally by state/ready status)')
    .option('-s, --status <status>', 'open | active | blocked | done | cancelled')
    .option('--space <spaceRef>', 'Filter threads by space ref')
    .option('--ready', 'Only include threads ready to be claimed now')
    .option('--json', 'Emit structured JSON output')
).action((opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      let threads = opts.space
        ? workgraph.store.threadsInSpace(workspacePath, opts.space)
        : workgraph.store.list(workspacePath, 'thread');
      const readySet = new Set(
        (opts.space
          ? workgraph.thread.listReadyThreadsInSpace(workspacePath, opts.space)
          : workgraph.thread.listReadyThreads(workspacePath))
          .map(t => t.path)
      );
      if (opts.status) threads = threads.filter(t => t.fields.status === opts.status);
      if (opts.ready) threads = threads.filter(t => readySet.has(t.path));
      const enriched = threads.map(t => ({
        ...t,
        ready: readySet.has(t.path),
      }));
      return { threads: enriched, count: enriched.length };
    },
    (result) => {
      if (result.threads.length === 0) return ['No threads found.'];
      return [
        ...result.threads.map((t) => {
          const status = String(t.fields.status);
          const owner = t.fields.owner ? ` (${String(t.fields.owner)})` : '';
          const ready = t.ready ? ' ready' : '';
          return `[${status}]${ready} ${String(t.fields.title)}${owner} -> ${t.path}`;
        }),
        `${result.count} thread(s)`,
      ];
    }
  )
);

addWorkspaceOption(
  threadCmd
    .command('next')
    .description('Pick the next ready thread, optionally claim it')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('--space <spaceRef>', 'Restrict scheduling to one space')
    .option('--claim', 'Immediately claim the next ready thread')
    .option('--fail-on-empty', 'Exit non-zero if no ready thread exists')
    .option('--json', 'Emit structured JSON output')
).action((opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const thread = opts.claim
        ? (opts.space
            ? workgraph.thread.claimNextReadyInSpace(workspacePath, opts.actor, opts.space)
            : workgraph.thread.claimNextReady(workspacePath, opts.actor))
        : (opts.space
            ? workgraph.thread.pickNextReadyThreadInSpace(workspacePath, opts.space)
            : workgraph.thread.pickNextReadyThread(workspacePath));
      if (!thread && opts.failOnEmpty) {
        throw new Error('No ready threads available.');
      }
      return {
        thread,
        claimed: !!opts.claim && !!thread,
      };
    },
    (result) => {
      if (!result.thread) return ['No ready thread available.'];
      return [
        `${result.claimed ? 'Claimed' : 'Selected'} thread: ${result.thread.path}`,
        `Title: ${String(result.thread.fields.title)}`,
        ...(result.thread.fields.space ? [`Space: ${String(result.thread.fields.space)}`] : []),
      ];
    }
  )
);

addWorkspaceOption(
  threadCmd
    .command('show <threadPath>')
    .description('Show thread details and ledger history')
    .option('--json', 'Emit structured JSON output')
).action((threadPath, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const thread = workgraph.store.read(workspacePath, threadPath);
      if (!thread) throw new Error(`Thread not found: ${threadPath}`);
      const history = workgraph.ledger.historyOf(workspacePath, threadPath);
      return { thread, history };
    },
    (result) => [
      `${String(result.thread.fields.title)} (${result.thread.path})`,
      `Status: ${String(result.thread.fields.status)} Owner: ${String(result.thread.fields.owner ?? 'unclaimed')}`,
      `History entries: ${result.history.length}`,
    ]
  )
);

addWorkspaceOption(
  threadCmd
    .command('claim <threadPath>')
    .description('Claim a thread for this agent')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('--json', 'Emit structured JSON output')
).action((threadPath, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      return { thread: workgraph.thread.claim(workspacePath, threadPath, opts.actor) };
    },
    (result) => [`Claimed: ${result.thread.path}`, `Owner: ${String(result.thread.fields.owner)}`]
  )
);

addWorkspaceOption(
  threadCmd
    .command('release <threadPath>')
    .description('Release a claimed thread back to open')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('--reason <reason>', 'Why you are releasing')
    .option('--json', 'Emit structured JSON output')
).action((threadPath, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      return { thread: workgraph.thread.release(workspacePath, threadPath, opts.actor, opts.reason) };
    },
    (result) => [`Released: ${result.thread.path}`, `Status: ${String(result.thread.fields.status)}`]
  )
);

addWorkspaceOption(
  threadCmd
    .command('done <threadPath>')
    .description('Mark a thread done')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('-o, --output <text>', 'Output/result summary')
    .option('--json', 'Emit structured JSON output')
).action((threadPath, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      return { thread: workgraph.thread.done(workspacePath, threadPath, opts.actor, opts.output) };
    },
    (result) => [`Done: ${result.thread.path}`]
  )
);

addWorkspaceOption(
  threadCmd
    .command('block <threadPath>')
    .description('Mark a thread blocked')
    .requiredOption('-b, --blocked-by <dep>', 'Dependency blocking this thread')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('--reason <reason>', 'Why it is blocked')
    .option('--json', 'Emit structured JSON output')
).action((threadPath, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      return {
        thread: workgraph.thread.block(workspacePath, threadPath, opts.actor, opts.blockedBy, opts.reason),
      };
    },
    (result) => [`Blocked: ${result.thread.path}`]
  )
);

addWorkspaceOption(
  threadCmd
    .command('unblock <threadPath>')
    .description('Unblock a thread')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('--json', 'Emit structured JSON output')
).action((threadPath, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      return { thread: workgraph.thread.unblock(workspacePath, threadPath, opts.actor) };
    },
    (result) => [`Unblocked: ${result.thread.path}`]
  )
);

addWorkspaceOption(
  threadCmd
    .command('decompose <threadPath>')
    .description('Break a thread into sub-threads')
    .requiredOption('--sub <specs...>', 'Sub-thread specs as "title|goal"')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('--json', 'Emit structured JSON output')
).action((threadPath, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const subthreads = opts.sub.map((spec: string) => {
        const [title, ...goalParts] = spec.split('|');
        const goal = goalParts.join('|').trim() || title.trim();
        return { title: title.trim(), goal };
      });
      return { children: workgraph.thread.decompose(workspacePath, threadPath, subthreads, opts.actor) };
    },
    (result) => [`Created ${result.children.length} sub-thread(s).`]
  )
);

// ============================================================================
// primitive
// ============================================================================

const primitiveCmd = program
  .command('primitive')
  .description('Manage primitive type definitions and instances');

addWorkspaceOption(
  primitiveCmd
    .command('define <name>')
    .description('Define a new primitive type')
    .requiredOption('-d, --description <desc>', 'Type description')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('--fields <specs...>', 'Field definitions as "name:type"')
    .option('--dir <directory>', 'Storage directory override')
    .option('--json', 'Emit structured JSON output')
).action((name, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const fields: Record<string, workgraph.FieldDefinition> = {};
      for (const spec of opts.fields ?? []) {
        const [fieldName, fieldType = 'string'] = String(spec).split(':');
        fields[fieldName.trim()] = { type: fieldType.trim() as workgraph.FieldDefinition['type'] };
      }
      return {
        type: workgraph.registry.defineType(
          workspacePath,
          name,
          opts.description,
          fields,
          opts.actor,
          opts.dir
        ),
      };
    },
    (result) => [`Defined type: ${result.type.name}`, `Directory: ${result.type.directory}/`]
  )
);

addWorkspaceOption(
  primitiveCmd
    .command('list')
    .description('List primitive types')
    .option('--json', 'Emit structured JSON output')
).action((opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const types = workgraph.registry.listTypes(workspacePath);
      return { types, count: types.length };
    },
    (result) => result.types.map(t => `${t.name} (${t.directory}/) ${t.builtIn ? '[built-in]' : ''}`)
  )
);

addWorkspaceOption(
  primitiveCmd
    .command('create <type> <title>')
    .description('Create an instance of any primitive type')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('--set <fields...>', 'Set fields as "key=value"')
    .option('--body <text>', 'Markdown body content', '')
    .option('--json', 'Emit structured JSON output')
).action((type, title, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const fields: Record<string, unknown> = { title };
      for (const pair of opts.set ?? []) {
        const eqIdx = String(pair).indexOf('=');
        if (eqIdx === -1) continue;
        const key = String(pair).slice(0, eqIdx).trim();
        let value: unknown = String(pair).slice(eqIdx + 1).trim();
        if (typeof value === 'string' && value.includes(',')) {
          value = value.split(',').map(v => v.trim());
        }
        fields[key] = value;
      }
      return {
        instance: workgraph.store.create(workspacePath, type, fields, opts.body, opts.actor),
      };
    },
    (result) => [`Created ${result.instance.type}: ${result.instance.path}`]
  )
);

// ============================================================================
// ledger
// ============================================================================

const ledgerCmd = program
  .command('ledger')
  .description('Inspect the append-only workgraph ledger');

addWorkspaceOption(
  ledgerCmd
    .command('show')
    .description('Show recent ledger entries')
    .option('-n, --count <n>', 'Number of entries', '20')
    .option('--actor <name>', 'Filter by actor')
    .option('--json', 'Emit structured JSON output')
).action((opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const count = Number.parseInt(String(opts.count), 10);
      const safeCount = Number.isNaN(count) ? 20 : count;
      let entries = workgraph.ledger.recent(workspacePath, safeCount);
      if (opts.actor) entries = entries.filter(e => e.actor === opts.actor);
      return { entries, count: entries.length };
    },
    (result) => result.entries.map(e => `${e.ts} ${e.op} ${e.actor} ${e.target}`)
  )
);

addWorkspaceOption(
  ledgerCmd
    .command('history <targetPath>')
    .description('Show full history of a target path')
    .option('--json', 'Emit structured JSON output')
).action((targetPath, opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const entries = workgraph.ledger.historyOf(workspacePath, targetPath);
      return { target: targetPath, entries, count: entries.length };
    },
    (result) => result.entries.map(e => `${e.ts} ${e.op} ${e.actor}`)
  )
);

addWorkspaceOption(
  ledgerCmd
    .command('claims')
    .description('Show active claims')
    .option('--json', 'Emit structured JSON output')
).action((opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const claimsMap = workgraph.ledger.allClaims(workspacePath);
      const claims = [...claimsMap.entries()].map(([target, owner]) => ({ target, owner }));
      return { claims, count: claims.length };
    },
    (result) => result.claims.map(c => `${c.owner} -> ${c.target}`)
  )
);

addWorkspaceOption(
  program
    .command('command-center')
    .description('Generate a markdown command center from workgraph state')
    .option('-a, --actor <name>', 'Agent name', DEFAULT_ACTOR)
    .option('-o, --output <path>', 'Output markdown path', 'Command Center.md')
    .option('-n, --recent <count>', 'Recent ledger entries to include', '15')
    .option('--json', 'Emit structured JSON output')
).action((opts) =>
  runCommand(
    opts,
    () => {
      const workspacePath = resolveWorkspacePath(opts);
      const parsedRecent = Number.parseInt(String(opts.recent), 10);
      const safeRecent = Number.isNaN(parsedRecent) ? 15 : parsedRecent;
      return workgraph.commandCenter.generateCommandCenter(workspacePath, {
        actor: opts.actor,
        outputPath: opts.output,
        recentCount: safeRecent,
      });
    },
    (result) => [
      `Generated command center: ${result.outputPath}`,
      `Threads: total=${result.stats.totalThreads} open=${result.stats.openThreads} active=${result.stats.activeThreads} blocked=${result.stats.blockedThreads}`,
      `Claims: ${result.stats.activeClaims} Recent events: ${result.stats.recentEvents}`,
    ]
  )
);

program.parse();

function addWorkspaceOption<T extends Command>(command: T): T {
  return command
    .option('-w, --workspace <path>', 'Workgraph workspace path')
    .option('--vault <path>', 'Alias for --workspace');
}

function resolveWorkspacePath(opts: JsonCapableOptions): string {
  const explicit = opts.workspace || opts.vault;
  if (explicit) return path.resolve(explicit);
  if (process.env.WORKGRAPH_PATH) return path.resolve(process.env.WORKGRAPH_PATH);
  if (process.env.CLAWVAULT_PATH) return path.resolve(process.env.CLAWVAULT_PATH);
  return process.cwd();
}

function csv(value?: string): string[] | undefined {
  if (!value) return undefined;
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function wantsJson(opts: JsonCapableOptions): boolean {
  if (opts.json) return true;
  if (process.env.WORKGRAPH_JSON === '1') return true;
  return false;
}

function runCommand<T>(
  opts: JsonCapableOptions,
  action: () => T,
  renderText: (result: T) => string[]
): void {
  try {
    const result = action();
    if (wantsJson(opts)) {
      console.log(JSON.stringify({ ok: true, data: result }, null, 2));
      return;
    }
    const lines = renderText(result);
    for (const line of lines) console.log(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (wantsJson(opts)) {
      console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(`Error: ${message}`);
    }
    process.exit(1);
  }
}
