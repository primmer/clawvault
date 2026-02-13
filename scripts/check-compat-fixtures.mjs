import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const fixturesRoot = path.join(repoRoot, 'tests', 'compat-fixtures');

const cases = [
  { name: 'healthy', expectedExitCode: 0 },
  { name: 'missing-requires-bin', expectedExitCode: 1 },
  { name: 'non-auto-profile', expectedExitCode: 1 }
];

function createOpenClawShim() {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-openclaw-shim-'));
  const shimPath = path.join(shimDir, 'openclaw');
  fs.writeFileSync(shimPath, '#!/usr/bin/env bash\nexit 0\n', 'utf-8');
  fs.chmodSync(shimPath, 0o755);
  return { shimDir, shimPath };
}

function runCase(caseName, expectedExitCode, env) {
  const fixturePath = path.join(fixturesRoot, caseName);
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
  const passed = actualExitCode === expectedExitCode;
  const summary = `${passed ? '✓' : '✗'} fixture=${caseName} expected=${expectedExitCode} actual=${actualExitCode}`;
  console.log(summary);

  if (!passed) {
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
      .map((testCase) => runCase(testCase.name, testCase.expectedExitCode, env))
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
