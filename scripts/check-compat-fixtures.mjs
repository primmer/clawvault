import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const fixturesRoot = path.join(repoRoot, 'tests', 'compat-fixtures');

const cases = [
  {
    name: 'healthy',
    expectedExitCode: 0,
    expectedWarnings: 0,
    expectedErrors: 0,
    expectedCheckStatuses: {
      'hook manifest events': 'ok',
      'hook manifest requirements': 'ok',
      'hook handler safety': 'ok'
    }
  },
  {
    name: 'missing-requires-bin',
    expectedExitCode: 1,
    expectedWarnings: 1,
    expectedErrors: 0,
    expectedCheckStatuses: {
      'hook manifest requirements': 'warn'
    }
  },
  {
    name: 'non-auto-profile',
    expectedExitCode: 1,
    expectedWarnings: 1,
    expectedErrors: 0,
    expectedCheckStatuses: {
      'hook handler safety': 'warn'
    }
  },
  {
    name: 'missing-events',
    expectedExitCode: 1,
    expectedWarnings: 0,
    expectedErrors: 1,
    expectedCheckStatuses: {
      'hook manifest events': 'error'
    }
  },
  {
    name: 'missing-package-hook',
    expectedExitCode: 1,
    expectedWarnings: 0,
    expectedErrors: 1,
    expectedCheckStatuses: {
      'package hook registration': 'error'
    }
  }
];

function createOpenClawShim() {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-openclaw-shim-'));
  const shimPath = path.join(shimDir, 'openclaw');
  fs.writeFileSync(shimPath, '#!/usr/bin/env bash\nexit 0\n', 'utf-8');
  fs.chmodSync(shimPath, 0o755);
  return { shimDir, shimPath };
}

function ensureCompatReportShape(report, caseName) {
  if (!report || typeof report !== 'object') {
    throw new Error(`fixture=${caseName} emitted non-object JSON report`);
  }
  if (typeof report.generatedAt !== 'string') {
    throw new Error(`fixture=${caseName} report missing generatedAt`);
  }
  if (!Array.isArray(report.checks)) {
    throw new Error(`fixture=${caseName} report missing checks[]`);
  }
  if (typeof report.warnings !== 'number' || typeof report.errors !== 'number') {
    throw new Error(`fixture=${caseName} report missing warnings/errors counts`);
  }
}

function parseCompatReport(stdout, caseName) {
  try {
    const parsed = JSON.parse(stdout);
    ensureCompatReportShape(parsed, caseName);
    return parsed;
  } catch (err) {
    throw new Error(`fixture=${caseName} produced invalid JSON report: ${err?.message || String(err)}`);
  }
}

function runCase(testCase, env) {
  const fixturePath = path.join(fixturesRoot, testCase.name);
  const result = spawnSync(
    process.execPath,
    ['./bin/clawvault.js', 'compat', '--strict', '--base-dir', fixturePath, '--json'],
    {
      cwd: repoRoot,
      env,
      encoding: 'utf-8'
    }
  );

  const actualExitCode = result.status ?? 1;
  const exitMatches = actualExitCode === testCase.expectedExitCode;
  let report = null;
  let outputMatches = false;
  let outputError = null;

  try {
    report = parseCompatReport(result.stdout, testCase.name);
    const warningsMatch = report.warnings === testCase.expectedWarnings;
    const errorsMatch = report.errors === testCase.expectedErrors;
    const statusMatches = Object.entries(testCase.expectedCheckStatuses).every(([label, expectedStatus]) => {
      const check = report.checks.find((candidate) => candidate?.label === label);
      return check?.status === expectedStatus;
    });
    outputMatches = warningsMatch && errorsMatch && statusMatches;
  } catch (err) {
    outputError = err;
    outputMatches = false;
  }

  const passed = exitMatches && outputMatches;
  const summary = `${passed ? '✓' : '✗'} fixture=${testCase.name} expectedExit=${testCase.expectedExitCode} actualExit=${actualExitCode}`;
  console.log(summary);

  if (!passed) {
    if (outputError) {
      console.error(outputError.message);
    }
    if (report) {
      console.error(`expected warnings/errors=${testCase.expectedWarnings}/${testCase.expectedErrors} actual=${report.warnings}/${report.errors}`);
    }
    console.error(result.stdout);
    console.error(result.stderr);
  }

  return passed;
}

function main() {
  const { shimDir } = createOpenClawShim();
  const env = {
    ...process.env,
    PATH: `${shimDir}:${process.env.PATH ?? ''}`
  };

  try {
    const failures = cases
      .map((testCase) => runCase(testCase, env))
      .filter((passed) => !passed).length;

    if (failures > 0) {
      console.error(`Compatibility fixture check failed: ${failures} case(s).`);
      process.exit(1);
    }

    console.log('Compatibility fixture check passed.');
  } finally {
    fs.rmSync(shimDir, { recursive: true, force: true });
  }
}

main();
