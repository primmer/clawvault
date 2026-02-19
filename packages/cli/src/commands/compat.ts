import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

export type CompatStatus = 'ok' | 'warn' | 'error';

export interface CompatCheck {
  label: string;
  status: CompatStatus;
  detail?: string;
  hint?: string;
}

export interface CompatReport {
  generatedAt: string;
  checks: CompatCheck[];
  warnings: number;
  errors: number;
}

interface CompatOptions {
  baseDir?: string;
}

export interface CompatCommandOptions {
  json?: boolean;
  strict?: boolean;
  baseDir?: string;
}

function readOptionalFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

function resolveProjectFile(relativePath: string, baseDir?: string): string {
  if (baseDir) {
    return path.resolve(baseDir, relativePath);
  }

  const fromCwd = path.resolve(process.cwd(), relativePath);
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }

  return path.resolve(findPackageRoot(), relativePath);
}

function checkOpenClawCli(): CompatCheck {
  const result = spawnSync('openclaw', ['--version'], { stdio: 'ignore' });
  if (result.error) {
    return {
      label: 'openclaw CLI available',
      status: 'warn',
      detail: 'openclaw binary not found',
      hint: 'Install OpenClaw CLI to enable plugin runtime validation.'
    };
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    return {
      label: 'openclaw CLI available',
      status: 'warn',
      detail: `openclaw --version exited with code ${result.status}`,
      hint: 'Ensure OpenClaw CLI is installed and runnable in PATH.'
    };
  }
  if (typeof result.signal === 'string' && result.signal.length > 0) {
    return {
      label: 'openclaw CLI available',
      status: 'warn',
      detail: `openclaw --version terminated by signal ${result.signal}`,
      hint: 'Ensure OpenClaw CLI can execute normally in PATH.'
    };
  }
  return { label: 'openclaw CLI available', status: 'ok' };
}

function checkPluginManifest(options: CompatOptions): CompatCheck {
  const manifestRaw = readOptionalFile(
    resolveProjectFile('openclaw.plugin.json', options.baseDir)
  );
  if (!manifestRaw) {
    return {
      label: 'plugin manifest',
      status: 'error',
      detail: 'openclaw.plugin.json not found',
      hint: 'Create openclaw.plugin.json with id, kind, and configSchema fields.'
    };
  }

  try {
    const manifest = JSON.parse(manifestRaw) as {
      id?: string;
      kind?: string;
      configSchema?: unknown;
    };
    const issues: string[] = [];
    if (!manifest.id) issues.push('missing id');
    if (!manifest.kind) issues.push('missing kind');
    if (!manifest.configSchema) issues.push('missing configSchema');

    if (issues.length > 0) {
      return {
        label: 'plugin manifest',
        status: 'error',
        detail: issues.join(', ')
      };
    }
    return {
      label: 'plugin manifest',
      status: 'ok',
      detail: `id=${manifest.id} kind=${manifest.kind}`
    };
  } catch (err: any) {
    return {
      label: 'plugin manifest',
      status: 'error',
      detail: err?.message || 'Unable to parse openclaw.plugin.json'
    };
  }
}

function checkPluginExtensions(options: CompatOptions): CompatCheck {
  let packageRaw = readOptionalFile(
    resolveProjectFile('package.json', options.baseDir)
  );

  // If cwd package.json doesn't contain openclaw config, fall back to installed package
  if (packageRaw && !options.baseDir) {
    try {
      const parsed = JSON.parse(packageRaw) as {
        openclaw?: { extensions?: string[] };
      };
      if (!parsed.openclaw?.extensions) {
        const fallbackPath = path.resolve(findPackageRoot(), 'package.json');
        const fallbackRaw = readOptionalFile(fallbackPath);
        if (fallbackRaw) packageRaw = fallbackRaw;
      }
    } catch {
      // continue with original
    }
  }

  if (!packageRaw) {
    return {
      label: 'plugin extensions registration',
      status: 'error',
      detail: 'package.json not found'
    };
  }

  try {
    const parsed = JSON.parse(packageRaw) as {
      openclaw?: { extensions?: string[] };
    };
    const extensions = parsed.openclaw?.extensions ?? [];
    if (extensions.length === 0) {
      return {
        label: 'plugin extensions registration',
        status: 'error',
        detail: 'Missing openclaw.extensions in package.json',
        hint: 'Add openclaw.extensions: ["./dist/plugin/index.js"] to package.json.'
      };
    }

    // Verify entry files exist
    const baseDir = options.baseDir || findPackageRoot();
    const missing = extensions.filter(
      (ext) => !fs.existsSync(path.resolve(baseDir, ext))
    );
    if (missing.length > 0) {
      return {
        label: 'plugin extensions registration',
        status: 'error',
        detail: `Entry file(s) not found: ${missing.join(', ')}`,
        hint: 'Run npm run build to generate dist files.'
      };
    }

    return {
      label: 'plugin extensions registration',
      status: 'ok',
      detail: extensions.join(', ')
    };
  } catch (err: any) {
    return {
      label: 'plugin extensions registration',
      status: 'error',
      detail: err?.message || 'Unable to parse package.json'
    };
  }
}

function checkSkillMetadata(options: CompatOptions): CompatCheck {
  const skillRaw = readOptionalFile(
    resolveProjectFile('SKILL.md', options.baseDir)
  );
  if (!skillRaw) {
    return {
      label: 'skill metadata',
      status: 'warn',
      detail: 'SKILL.md not found',
      hint: 'Ensure SKILL.md is present for OpenClaw skill distribution.'
    };
  }

  let hasOpenClawMetadata = false;
  let parseError: string | undefined;
  try {
    const parsed = matter(skillRaw);
    const frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
    const metadata =
      frontmatter.metadata &&
      typeof frontmatter.metadata === 'object' &&
      !Array.isArray(frontmatter.metadata)
        ? (frontmatter.metadata as Record<string, unknown>)
        : undefined;

    hasOpenClawMetadata = Boolean(
      (metadata &&
        typeof metadata.openclaw === 'object' &&
        metadata.openclaw !== null) ||
        (typeof frontmatter.openclaw === 'object' &&
          frontmatter.openclaw !== null)
    );
  } catch {
    parseError = 'Unable to parse SKILL.md frontmatter';
    hasOpenClawMetadata = false;
  }

  if (!hasOpenClawMetadata) {
    hasOpenClawMetadata = /"openclaw"\s*:/.test(skillRaw);
  }

  if (!hasOpenClawMetadata) {
    const detail = parseError
      ? `${parseError} (or missing metadata.openclaw)`
      : 'Missing metadata.openclaw in SKILL.md';
    return {
      label: 'skill metadata',
      status: 'warn',
      detail,
      hint: 'Add metadata.openclaw to SKILL.md frontmatter for OpenClaw compatibility.'
    };
  }

  return { label: 'skill metadata', status: 'ok' };
}

export function checkOpenClawCompatibility(
  options: CompatOptions = {}
): CompatReport {
  const checks = [
    checkOpenClawCli(),
    checkPluginManifest(options),
    checkPluginExtensions(options),
    checkSkillMetadata(options),
  ];

  const warnings = checks.filter((check) => check.status === 'warn').length;
  const errors = checks.filter((check) => check.status === 'error').length;

  return {
    generatedAt: new Date().toISOString(),
    checks,
    warnings,
    errors,
  };
}

function formatCompatibilityReport(report: CompatReport): string {
  const lines: string[] = [];
  lines.push('OpenClaw Compatibility Report');
  lines.push('-'.repeat(34));
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');

  for (const check of report.checks) {
    const prefix =
      check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    lines.push(
      `${prefix} ${check.label}${check.detail ? ` — ${check.detail}` : ''}`
    );
    if (check.hint) {
      lines.push(`  ${check.hint}`);
    }
  }

  lines.push('');
  lines.push(`Warnings: ${report.warnings}`);
  lines.push(`Errors: ${report.errors}`);
  return lines.join('\n');
}

export function compatibilityExitCode(
  report: CompatReport,
  options: { strict?: boolean } = {}
): number {
  if (report.errors > 0) {
    return 1;
  }
  if (options.strict && report.warnings > 0) {
    return 1;
  }
  return 0;
}

export async function compatCommand(
  options: CompatCommandOptions = {}
): Promise<CompatReport> {
  const report = checkOpenClawCompatibility({ baseDir: options.baseDir });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatCompatibilityReport(report));
  }
  return report;
}
