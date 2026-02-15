import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { Command } from 'commander';
import { resolveVaultPath } from '../lib/config.js';
import { scanVaultLinks } from '../lib/backlinks.js';
import { formatAge } from '../lib/time.js';
import { hasQmd, qmdEmbed, qmdUpdate } from '../lib/search.js';
import { listQmdCollections, removeQmdCollection, type QmdCollectionInfo } from '../lib/qmd-collections.js';
import { loadVaultQmdConfig } from '../lib/vault-qmd-config.js';

const CLAWVAULT_DIR = '.clawvault';
const OBSERVE_CURSOR_FILE = 'observe-cursors.json';
const CHECKPOINT_FILE = 'last-checkpoint.json';
const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export type DoctorStatus = 'ok' | 'warn' | 'error';
export type DoctorCheckId =
  | 'stale_qmd_index'
  | 'pending_embeddings'
  | 'dead_qmd_collections'
  | 'stale_observer'
  | 'stale_checkpoint'
  | 'orphan_wiki_links'
  | 'dirty_git';

export interface DoctorCheck {
  id: DoctorCheckId;
  label: string;
  status: DoctorStatus;
  detail: string;
  hint?: string;
  fixable: boolean;
  fixed?: boolean;
}

export interface DoctorReport {
  vaultPath: string;
  qmdCollection: string;
  qmdRoot: string;
  generatedAt: string;
  fixApplied: boolean;
  checks: DoctorCheck[];
  warnings: number;
  errors: number;
}

export interface DoctorOptions {
  vaultPath?: string;
  fix?: boolean;
  now?: () => Date;
}

export interface DoctorCommandOptions extends DoctorOptions {
  json?: boolean;
}

interface ObserverTimestamp {
  key: string;
  timestamp: string;
  ageMs: number;
}

function countMarkdownFiles(rootPath: string): number {
  if (!fs.existsSync(rootPath)) return 0;
  const stat = fs.statSync(rootPath);
  if (!stat.isDirectory()) {
    return stat.isFile() && rootPath.endsWith('.md') ? 1 : 0;
  }

  const skipDirectories = new Set(['.git', 'node_modules']);
  let count = 0;

  const walk = (currentPath: string): void => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirectories.has(entry.name)) continue;
        walk(path.join(currentPath, entry.name));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        count += 1;
      }
    }
  };

  walk(rootPath);
  return count;
}

function findGitRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function getGitDirtyCount(repoRoot: string): number {
  const output = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], {
    encoding: 'utf-8'
  });
  return output.split('\n').filter(Boolean).length;
}

function resolveTimestampFromCursor(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;

  if (typeof entry.lastObservedAt === 'string' && entry.lastObservedAt.trim()) {
    return entry.lastObservedAt.trim();
  }
  if (typeof entry.updatedAt === 'string' && entry.updatedAt.trim()) {
    return entry.updatedAt.trim();
  }
  if (typeof entry.timestamp === 'string' && entry.timestamp.trim()) {
    return entry.timestamp.trim();
  }
  if (typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)) {
    return new Date(entry.updatedAt).toISOString();
  }

  return null;
}

function readObserverTimestamps(vaultPath: string, nowMs: number): {
  timestamps: ObserverTimestamp[];
  parseError?: string;
} {
  const cursorPath = path.join(vaultPath, CLAWVAULT_DIR, OBSERVE_CURSOR_FILE);
  if (!fs.existsSync(cursorPath)) {
    return { timestamps: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(cursorPath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { timestamps: [] };
    }
    const entries = parsed as Record<string, unknown>;
    const timestamps: ObserverTimestamp[] = [];

    for (const [key, value] of Object.entries(entries)) {
      const timestamp = resolveTimestampFromCursor(value);
      if (!timestamp) continue;
      const epochMs = new Date(timestamp).getTime();
      if (!Number.isFinite(epochMs)) continue;
      timestamps.push({
        key,
        timestamp,
        ageMs: Math.max(0, nowMs - epochMs)
      });
    }

    return { timestamps };
  } catch (err: any) {
    return { timestamps: [], parseError: err?.message || 'Failed to parse observer cursor file' };
  }
}

function readCheckpointTimestamp(vaultPath: string): { timestamp?: string; parseError?: string } {
  const checkpointPath = path.join(vaultPath, CLAWVAULT_DIR, CHECKPOINT_FILE);
  if (!fs.existsSync(checkpointPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8')) as { timestamp?: unknown };
    if (typeof parsed.timestamp !== 'string' || !parsed.timestamp.trim()) {
      return {};
    }
    return { timestamp: parsed.timestamp.trim() };
  } catch (err: any) {
    return { parseError: err?.message || 'Failed to parse checkpoint file' };
  }
}

function normalizeDoctorOptions(
  vaultPathOrOptions?: string | DoctorOptions,
  maybeOptions: DoctorOptions = {}
): DoctorOptions {
  if (typeof vaultPathOrOptions === 'string') {
    return { ...maybeOptions, vaultPath: vaultPathOrOptions };
  }
  return {
    ...vaultPathOrOptions,
    ...maybeOptions
  };
}

function statusIcon(status: DoctorStatus): string {
  if (status === 'ok') return '✓';
  if (status === 'warn') return '⚠';
  return '✗';
}

function makeCheck(input: DoctorCheck): DoctorCheck {
  return input;
}

function countStatus(checks: DoctorCheck[], status: DoctorStatus): number {
  return checks.filter((check) => check.status === status).length;
}

export async function doctor(
  vaultPathOrOptions?: string | DoctorOptions,
  maybeOptions: DoctorOptions = {}
): Promise<DoctorReport> {
  const options = normalizeDoctorOptions(vaultPathOrOptions, maybeOptions);
  const fix = Boolean(options.fix);
  const nowDate = options.now ? options.now() : new Date();
  const nowMs = nowDate.getTime();

  const vaultPath = resolveVaultPath({ explicitPath: options.vaultPath });
  const qmdConfig = loadVaultQmdConfig(vaultPath);
  const checks: DoctorCheck[] = [];

  const qmdAvailable = hasQmd();
  let qmdCollections: QmdCollectionInfo[] = [];
  let qmdCollectionError: string | undefined;

  if (qmdAvailable) {
    try {
      qmdCollections = listQmdCollections();
    } catch (err: any) {
      qmdCollectionError = err?.message || 'Failed to list qmd collections';
    }
  }

  const mainCollection = qmdCollections.find((entry) => entry.name === qmdConfig.qmdCollection);
  const diskMarkdownCount = countMarkdownFiles(qmdConfig.qmdRoot);
  const indexedCount = mainCollection?.files;
  let staleDocCount = 0;

  if (!qmdAvailable) {
    checks.push(makeCheck({
      id: 'stale_qmd_index',
      label: 'qmd index',
      status: 'error',
      detail: 'qmd is not installed',
      hint: 'Install qmd to enable index and embedding health checks.',
      fixable: false
    }));
  } else if (qmdCollectionError) {
    checks.push(makeCheck({
      id: 'stale_qmd_index',
      label: 'qmd index',
      status: 'error',
      detail: qmdCollectionError,
      fixable: false
    }));
  } else if (!mainCollection) {
    checks.push(makeCheck({
      id: 'stale_qmd_index',
      label: 'qmd index',
      status: 'error',
      detail: `Collection "${qmdConfig.qmdCollection}" not found`,
      hint: 'Run `qmd collection list` and verify vault qmdCollection configuration.',
      fixable: false
    }));
  } else if (!fs.existsSync(qmdConfig.qmdRoot)) {
    checks.push(makeCheck({
      id: 'stale_qmd_index',
      label: 'qmd index',
      status: 'error',
      detail: `qmd root path does not exist: ${qmdConfig.qmdRoot}`,
      fixable: false
    }));
  } else if (indexedCount === undefined) {
    checks.push(makeCheck({
      id: 'stale_qmd_index',
      label: 'qmd index',
      status: 'warn',
      detail: 'Indexed file count unavailable from qmd collection list',
      fixable: fix
    }));
  } else {
    staleDocCount = Math.max(diskMarkdownCount - indexedCount, 0);
    if (staleDocCount > 0) {
      if (fix) {
        try {
          qmdUpdate(qmdConfig.qmdCollection);
          checks.push(makeCheck({
            id: 'stale_qmd_index',
            label: 'qmd index',
            status: 'ok',
            detail: `${diskMarkdownCount} on disk, ${indexedCount} indexed (${staleDocCount} missing, index updated)`,
            fixable: true,
            fixed: true
          }));
        } catch (err: any) {
          checks.push(makeCheck({
            id: 'stale_qmd_index',
            label: 'qmd index',
            status: 'error',
            detail: `${diskMarkdownCount} on disk, ${indexedCount} indexed (${staleDocCount} missing, update failed: ${err?.message || 'unknown error'})`,
            fixable: true,
            fixed: false
          }));
        }
      } else {
        checks.push(makeCheck({
          id: 'stale_qmd_index',
          label: 'qmd index',
          status: 'warn',
          detail: `${diskMarkdownCount} on disk, ${indexedCount} indexed (${staleDocCount} missing, run with --fix to update)`,
          fixable: true
        }));
      }
    } else {
      checks.push(makeCheck({
        id: 'stale_qmd_index',
        label: 'qmd index',
        status: 'ok',
        detail: `${indexedCount} indexed, ${diskMarkdownCount} on disk`,
        fixable: true
      }));
    }
  }

  if (!qmdAvailable) {
    checks.push(makeCheck({
      id: 'pending_embeddings',
      label: 'Embeddings',
      status: 'error',
      detail: 'qmd is not installed',
      fixable: false
    }));
  } else if (qmdCollectionError) {
    checks.push(makeCheck({
      id: 'pending_embeddings',
      label: 'Embeddings',
      status: 'error',
      detail: qmdCollectionError,
      fixable: false
    }));
  } else if (!mainCollection) {
    checks.push(makeCheck({
      id: 'pending_embeddings',
      label: 'Embeddings',
      status: 'error',
      detail: `Collection "${qmdConfig.qmdCollection}" not found`,
      fixable: false
    }));
  } else {
    const vectors = mainCollection.vectors
      ?? Math.max((mainCollection.files ?? diskMarkdownCount) - (mainCollection.pendingEmbeddings ?? 0), 0);
    const pending = mainCollection.pendingEmbeddings
      ?? Math.max((mainCollection.files ?? diskMarkdownCount) - vectors, 0);
    const shouldRunEmbed = fix && (pending > 0 || staleDocCount > 0);

    if (shouldRunEmbed) {
      try {
        qmdEmbed(qmdConfig.qmdCollection);
        checks.push(makeCheck({
          id: 'pending_embeddings',
          label: 'Embeddings',
          status: 'ok',
          detail: `${vectors} vectors, ${pending} pending (embed triggered)`,
          fixable: true,
          fixed: true
        }));
      } catch (err: any) {
        checks.push(makeCheck({
          id: 'pending_embeddings',
          label: 'Embeddings',
          status: 'error',
          detail: `${vectors} vectors, ${pending} pending (embed failed: ${err?.message || 'unknown error'})`,
          fixable: true,
          fixed: false
        }));
      }
    } else if (pending > 0) {
      checks.push(makeCheck({
        id: 'pending_embeddings',
        label: 'Embeddings',
        status: 'warn',
        detail: `${vectors} vectors, ${pending} pending (run with --fix to embed)`,
        fixable: true
      }));
    } else {
      checks.push(makeCheck({
        id: 'pending_embeddings',
        label: 'Embeddings',
        status: 'ok',
        detail: `${vectors} vectors, 0 pending`,
        fixable: true
      }));
    }
  }

  if (!qmdAvailable) {
    checks.push(makeCheck({
      id: 'dead_qmd_collections',
      label: 'Dead collections',
      status: 'error',
      detail: 'qmd is not installed',
      fixable: false
    }));
  } else if (qmdCollectionError) {
    checks.push(makeCheck({
      id: 'dead_qmd_collections',
      label: 'Dead collections',
      status: 'error',
      detail: qmdCollectionError,
      fixable: false
    }));
  } else {
    const deadCollections = qmdCollections.filter((collection) => {
      if (!collection.root) return false;
      return !fs.existsSync(path.resolve(collection.root));
    });

    if (deadCollections.length === 0) {
      checks.push(makeCheck({
        id: 'dead_qmd_collections',
        label: 'Dead collections',
        status: 'ok',
        detail: '0 found',
        fixable: true
      }));
    } else if (fix) {
      let removed = 0;
      const failed: string[] = [];
      for (const collection of deadCollections) {
        try {
          removeQmdCollection(collection.name);
          removed += 1;
        } catch {
          failed.push(collection.name);
        }
      }

      if (failed.length === 0) {
        checks.push(makeCheck({
          id: 'dead_qmd_collections',
          label: 'Dead collections',
          status: 'ok',
          detail: `${deadCollections.length} found, removed ${removed}`,
          fixable: true,
          fixed: true
        }));
      } else {
        checks.push(makeCheck({
          id: 'dead_qmd_collections',
          label: 'Dead collections',
          status: 'error',
          detail: `${deadCollections.length} found, removed ${removed}, failed ${failed.length}`,
          hint: `Failed collections: ${failed.join(', ')}`,
          fixable: true,
          fixed: false
        }));
      }
    } else {
      checks.push(makeCheck({
        id: 'dead_qmd_collections',
        label: 'Dead collections',
        status: 'error',
        detail: `${deadCollections.length} found (run with --fix to remove)`,
        fixable: true
      }));
    }
  }

  const observerInfo = readObserverTimestamps(vaultPath, nowMs);
  if (observerInfo.parseError) {
    checks.push(makeCheck({
      id: 'stale_observer',
      label: 'Observer',
      status: 'warn',
      detail: observerInfo.parseError,
      fixable: false
    }));
  } else if (observerInfo.timestamps.length === 0) {
    checks.push(makeCheck({
      id: 'stale_observer',
      label: 'Observer',
      status: 'ok',
      detail: 'No observer cursors found',
      fixable: false
    }));
  } else {
    const staleObservers = observerInfo.timestamps
      .filter((entry) => entry.ageMs > STALE_THRESHOLD_MS)
      .sort((left, right) => right.ageMs - left.ageMs);
    if (staleObservers.length > 0) {
      const oldest = staleObservers[0];
      checks.push(makeCheck({
        id: 'stale_observer',
        label: 'Observer',
        status: 'warn',
        detail: `${oldest.key} not observed in ${formatAge(oldest.ageMs)} (last: ${oldest.timestamp})`,
        fixable: false
      }));
    } else {
      const oldest = observerInfo.timestamps
        .slice()
        .sort((left, right) => right.ageMs - left.ageMs)[0];
      checks.push(makeCheck({
        id: 'stale_observer',
        label: 'Observer',
        status: 'ok',
        detail: `${observerInfo.timestamps.length} cursor(s), oldest ${formatAge(oldest.ageMs)} ago`,
        fixable: false
      }));
    }
  }

  const checkpoint = readCheckpointTimestamp(vaultPath);
  if (checkpoint.parseError) {
    checks.push(makeCheck({
      id: 'stale_checkpoint',
      label: 'Checkpoint',
      status: 'warn',
      detail: checkpoint.parseError,
      fixable: false
    }));
  } else if (!checkpoint.timestamp) {
    checks.push(makeCheck({
      id: 'stale_checkpoint',
      label: 'Checkpoint',
      status: 'warn',
      detail: `Missing ${CHECKPOINT_FILE}`,
      fixable: false
    }));
  } else {
    const checkpointAgeMs = nowMs - new Date(checkpoint.timestamp).getTime();
    if (!Number.isFinite(checkpointAgeMs)) {
      checks.push(makeCheck({
        id: 'stale_checkpoint',
        label: 'Checkpoint',
        status: 'warn',
        detail: `Invalid timestamp: ${checkpoint.timestamp}`,
        fixable: false
      }));
    } else if (checkpointAgeMs > STALE_THRESHOLD_MS) {
      checks.push(makeCheck({
        id: 'stale_checkpoint',
        label: 'Checkpoint',
        status: 'warn',
        detail: `Last checkpoint ${formatAge(checkpointAgeMs)} ago (last: ${checkpoint.timestamp})`,
        fixable: false
      }));
    } else {
      checks.push(makeCheck({
        id: 'stale_checkpoint',
        label: 'Checkpoint',
        status: 'ok',
        detail: `Last checkpoint ${formatAge(checkpointAgeMs)} ago`,
        fixable: false
      }));
    }
  }

  try {
    const orphanCount = scanVaultLinks(vaultPath).orphans.length;
    checks.push(makeCheck({
      id: 'orphan_wiki_links',
      label: 'Wiki-links',
      status: orphanCount > 0 ? 'warn' : 'ok',
      detail: `${orphanCount} orphan wiki-link(s)`,
      fixable: false
    }));
  } catch (err: any) {
    checks.push(makeCheck({
      id: 'orphan_wiki_links',
      label: 'Wiki-links',
      status: 'error',
      detail: err?.message || 'Failed to scan wiki-links',
      fixable: false
    }));
  }

  const gitRoot = findGitRoot(vaultPath);
  if (!gitRoot) {
    checks.push(makeCheck({
      id: 'dirty_git',
      label: 'Git',
      status: 'ok',
      detail: 'No git repository detected',
      fixable: false
    }));
  } else {
    try {
      const dirtyCount = getGitDirtyCount(gitRoot);
      checks.push(makeCheck({
        id: 'dirty_git',
        label: 'Git',
        status: dirtyCount > 0 ? 'warn' : 'ok',
        detail: dirtyCount > 0 ? `${dirtyCount} uncommitted change(s)` : 'Working tree clean',
        fixable: false
      }));
    } catch (err: any) {
      checks.push(makeCheck({
        id: 'dirty_git',
        label: 'Git',
        status: 'warn',
        detail: err?.message || 'Unable to inspect git status',
        fixable: false
      }));
    }
  }

  return {
    vaultPath,
    qmdCollection: qmdConfig.qmdCollection,
    qmdRoot: qmdConfig.qmdRoot,
    generatedAt: nowDate.toISOString(),
    fixApplied: fix,
    checks,
    warnings: countStatus(checks, 'warn'),
    errors: countStatus(checks, 'error')
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('ClawVault Doctor');
  lines.push('-'.repeat(40));
  lines.push(`Vault: ${report.vaultPath}`);
  lines.push(`qmd collection: ${report.qmdCollection}`);
  lines.push(`qmd root: ${report.qmdRoot}`);
  lines.push('');

  for (const check of report.checks) {
    lines.push(`${statusIcon(check.status)} ${check.label}: ${check.detail}`);
    if (check.hint) {
      lines.push(`  ${check.hint}`);
    }
  }

  lines.push('');
  lines.push(`Warnings: ${report.warnings}`);
  lines.push(`Errors: ${report.errors}`);
  lines.push('-'.repeat(40));

  return lines.join('\n');
}

export async function doctorCommand(options: DoctorCommandOptions = {}): Promise<DoctorReport> {
  const report = await doctor(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatDoctorReport(report));
  }
  return report;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose vault health and optionally apply fixes')
    .option('-v, --vault <path>', 'Vault path')
    .option('--fix', 'Apply safe fixes (qmd update, embed, remove dead collections)')
    .option('--json', 'Output machine-readable JSON')
    .action(async (rawOptions: { vault?: string; fix?: boolean; json?: boolean }) => {
      await doctorCommand({
        vaultPath: rawOptions.vault,
        fix: rawOptions.fix,
        json: rawOptions.json
      });
    });
}
