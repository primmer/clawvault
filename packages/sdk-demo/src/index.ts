import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

export interface WorkgraphJsonEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface WorkgraphJsonResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type WorkgraphRunnerResult = {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
  error?: Error;
};

export type WorkgraphRunner = (
  command: string,
  args: string[],
  options: SpawnSyncOptions
) => WorkgraphRunnerResult;

export interface RunWorkgraphJsonOptions {
  workspacePath?: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
  runner?: WorkgraphRunner;
}

export function runWorkgraphJson<T = unknown>(
  args: string[],
  options: RunWorkgraphJsonOptions = {}
): WorkgraphJsonResult<T> {
  const runner = options.runner ?? (spawnSync as WorkgraphRunner);
  const command = options.command ?? 'workgraph';
  const finalArgs = normalizeCliArgs(args, options.workspacePath);

  const result = runner(command, finalArgs, {
    encoding: 'utf-8',
    stdio: 'pipe',
    env: options.env,
  });

  const stdout = normalizeOutput(result.stdout);
  const stderr = normalizeOutput(result.stderr);
  const exitCode = result.status ?? 1;

  let parsed: WorkgraphJsonEnvelope<T> | null = null;
  try {
    parsed = JSON.parse(stdout) as WorkgraphJsonEnvelope<T>;
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed.ok === 'boolean') {
    return {
      ok: parsed.ok,
      data: parsed.data,
      error: parsed.error,
      stdout,
      stderr,
      exitCode,
    };
  }

  if (exitCode !== 0) {
    return {
      ok: false,
      error: stderr.trim() || stdout.trim() || `workgraph command failed (${exitCode})`,
      stdout,
      stderr,
      exitCode,
    };
  }

  return {
    ok: false,
    error: 'workgraph returned non-JSON output',
    stdout,
    stderr,
    exitCode,
  };
}

export class DemoWorkgraphSdk {
  constructor(
    private readonly workspacePath: string,
    private readonly actor: string = 'sdk-agent',
    private readonly runner?: WorkgraphRunner,
  ) {}

  init() {
    return runWorkgraphJson(
      ['init', this.workspacePath],
      this.baseOptions(),
    );
  }

  writeSkill(title: string, body: string) {
    return runWorkgraphJson(
      ['skill', 'write', title, '--body', body, '--actor', this.actor],
      this.baseOptions(),
    );
  }

  proposeSkill(skillRef: string) {
    return runWorkgraphJson(
      ['skill', 'propose', skillRef, '--actor', this.actor],
      this.baseOptions(),
    );
  }

  promoteSkill(skillRef: string) {
    return runWorkgraphJson(
      ['skill', 'promote', skillRef, '--actor', this.actor],
      this.baseOptions(),
    );
  }

  generateBases(includeAll = false) {
    return runWorkgraphJson(
      ['bases', 'generate', ...(includeAll ? ['--all'] : [])],
      this.baseOptions(),
    );
  }

  verifyLedger(strict = true) {
    return runWorkgraphJson(
      ['ledger', 'verify', ...(strict ? ['--strict'] : [])],
      this.baseOptions(),
    );
  }

  private baseOptions(): RunWorkgraphJsonOptions {
    return {
      workspacePath: this.workspacePath,
      runner: this.runner,
    };
  }
}

function normalizeCliArgs(args: string[], workspacePath?: string): string[] {
  const normalized = [...args];
  if (!normalized.includes('--json')) {
    normalized.push('--json');
  }
  if (
    workspacePath &&
    !hasWorkspaceSelector(normalized)
  ) {
    normalized.push('--workspace', workspacePath);
  }
  return normalized;
}

function hasWorkspaceSelector(args: string[]): boolean {
  return args.includes('--workspace') ||
    args.includes('-w') ||
    args.includes('--vault') ||
    args.includes('--shared-vault');
}

function normalizeOutput(value: string | Buffer): string {
  if (typeof value === 'string') return value;
  return value.toString('utf-8');
}
