#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');
const cliPath = path.join(packageRoot, 'bin', 'workgraph.js');

const options = parseArgs(process.argv.slice(2));
const workspacePath = options.workspace
  ? path.resolve(options.workspace)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'workgraph-cli-e2e-'));
const keepWorkspace = options.keep || Boolean(options.workspace);

let summary = null;

try {
  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }

  console.log(`Using workspace: ${workspacePath}`);

  const demo = runJson(
    [
      'demo',
      'bootstrap',
      workspacePath,
      '--name',
      'Standalone CLI Product Demo',
      '--actor',
      'agent-lead',
      '--worker-one',
      'agent-worker-1',
      '--worker-two',
      'agent-worker-2',
    ],
    'Bootstrap product-demo workspace',
  );
  assert(Array.isArray(demo.customTypes) && demo.customTypes.includes('milestone'),
    'Demo bootstrap must include custom primitive "milestone"');
  assert(Array.isArray(demo.threads.completed) && demo.threads.completed.length >= 4,
    'Demo bootstrap must complete at least 4 threads');

  const reinitError = runJson(
    ['init', workspacePath],
    'Re-initialization must fail',
    { expectSuccess: false },
  );
  assert(
    typeof reinitError === 'string' && reinitError.includes('already initialized'),
    'Re-initialization should return "already initialized" error',
  );

  const primitiveList = runJson(
    ['primitive', 'list', '--workspace', workspacePath],
    'List primitives in demo workspace',
  );
  const primitiveNames = primitiveList.types.map((typeDef) => typeDef.name);
  assert(primitiveNames.includes('milestone'), 'Primitive list should include milestone');
  assert(primitiveNames.includes('release-gate'), 'Primitive list should include release-gate');

  const doneThreads = runJson(
    ['thread', 'list', '--status', 'done', '--workspace', workspacePath],
    'List completed threads',
  );
  assert(doneThreads.count >= 4, 'Expected at least 4 completed threads after demo bootstrap');

  const emptyNextError = runJson(
    ['thread', 'next', '--claim', '--fail-on-empty', '--actor', 'agent-worker-1', '--workspace', workspacePath],
    'Ensure empty queue fails when requested',
    { expectSuccess: false },
  );
  assert(
    typeof emptyNextError === 'string' && emptyNextError.includes('No ready threads available'),
    'Expected fail-on-empty command to report no ready threads',
  );

  const edgeThread = runJson(
    [
      'thread',
      'create',
      'Claim contention check',
      '--goal',
      'Validate claim ownership protections',
      '--actor',
      'agent-lead',
      '--workspace',
      workspacePath,
    ],
    'Create contention-check thread',
  ).thread;

  runJson(
    ['thread', 'claim', edgeThread.path, '--actor', 'agent-worker-1', '--workspace', workspacePath],
    'Claim edge thread with worker one',
  );

  const doubleClaimError = runJson(
    ['thread', 'claim', edgeThread.path, '--actor', 'agent-worker-2', '--workspace', workspacePath],
    'Double claim should fail',
    { expectSuccess: false },
  );
  assert(
    typeof doubleClaimError === 'string' && doubleClaimError.includes('Cannot claim thread'),
    'Expected double claim to fail with status error',
  );

  const nonOwnerReleaseError = runJson(
    ['thread', 'release', edgeThread.path, '--actor', 'agent-worker-2', '--workspace', workspacePath],
    'Non-owner release should fail',
    { expectSuccess: false },
  );
  assert(
    typeof nonOwnerReleaseError === 'string' && nonOwnerReleaseError.includes('owned by'),
    'Expected non-owner release to fail with ownership error',
  );

  runJson(
    ['thread', 'release', edgeThread.path, '--actor', 'agent-worker-1', '--workspace', workspacePath],
    'Release edge thread by owner',
  );
  runJson(
    ['thread', 'claim', edgeThread.path, '--actor', 'agent-worker-2', '--workspace', workspacePath],
    'Re-claim edge thread by worker two',
  );
  runJson(
    [
      'thread',
      'done',
      edgeThread.path,
      '--actor',
      'agent-worker-2',
      '--output',
      'Ownership and contention checks passed.',
      '--workspace',
      workspacePath,
    ],
    'Complete edge thread',
  );

  const verify = runJson(
    ['ledger', 'verify', '--strict', '--workspace', workspacePath],
    'Verify tamper-evident ledger chain',
  );
  assert(verify.ok === true, 'Ledger verification must pass');
  assert(Array.isArray(verify.issues) && verify.issues.length === 0, 'Ledger verification should have no issues');

  const doneQuery = runJson(
    ['ledger', 'query', '--op', 'done', '--workspace', workspacePath],
    'Query done operations',
  );
  assert(doneQuery.entries.length >= 5, 'Expected done operations for demo plus edge thread');

  const blame = runJson(
    ['ledger', 'blame', edgeThread.path, '--workspace', workspacePath],
    'Show attribution for edge thread',
  );
  const blameActors = blame.actors.map((item) => item.actor);
  assert(blameActors.includes('agent-worker-1'), 'Blame should include agent-worker-1');
  assert(blameActors.includes('agent-worker-2'), 'Blame should include agent-worker-2');

  const skill = runJson(
    [
      'skill',
      'write',
      'Standalone Ops Manual',
      '--actor',
      'agent-lead',
      '--owner',
      'agent-lead',
      '--status',
      'draft',
      '--tags',
      'workgraph,demo',
      '--body',
      '# Standalone Ops Manual\n\n- Build\n- Test\n- Demo',
      '--workspace',
      workspacePath,
    ],
    'Write skill primitive',
  ).skill;

  runJson(
    [
      'skill',
      'propose',
      'standalone-ops-manual',
      '--actor',
      'agent-reviewer',
      '--space',
      'spaces/standalone-cli-program.md',
      '--workspace',
      workspacePath,
    ],
    'Propose skill primitive',
  );

  runJson(
    ['skill', 'promote', 'standalone-ops-manual', '--actor', 'agent-lead', '--workspace', workspacePath],
    'Promote skill primitive',
  );

  const loadedSkill = runJson(
    ['skill', 'load', skill.path, '--workspace', workspacePath],
    'Load promoted skill',
  ).skill;
  assert(loadedSkill.fields.status === 'active', 'Promoted skill should be active');

  const activeSkills = runJson(
    ['skill', 'list', '--status', 'active', '--workspace', workspacePath],
    'List active skills',
  );
  assert(activeSkills.count >= 1, 'Expected at least one active skill');

  const commandCenter = runJson(
    ['command-center', '--output', 'ops/Command Center.md', '--workspace', workspacePath],
    'Generate command center snapshot',
  );
  const commandCenterAbsolute = path.join(workspacePath, commandCenter.outputPath);
  assert(fs.existsSync(commandCenterAbsolute), 'Command center file should exist on disk');

  const bases = runJson(
    ['bases', 'generate', '--all', '--refresh-registry', '--workspace', workspacePath],
    'Generate bases including custom primitives',
  );
  assert(
    bases.generated.includes('.clawvault/bases/release-gate.base'),
    'Bases generation should include release-gate.base',
  );
  assert(
    bases.generated.includes('.clawvault/bases/skill.base'),
    'Bases generation should include skill.base',
  );

  summary = {
    workspacePath,
    commandCenterPath: commandCenter.outputPath,
    totalDoneOps: doneQuery.entries.length,
    primitiveCount: primitiveList.count,
    activeSkillCount: activeSkills.count,
    ledgerEntries: verify.entries,
  };

  console.log('Standalone CLI E2E: PASS');
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Standalone CLI E2E: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (!keepWorkspace && summary) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
}

function runJson(args, label, options = { expectSuccess: true }) {
  const commandArgs = args.includes('--json') ? args : [...args, '--json'];
  const result = spawnSync(process.execPath, [cliPath, ...commandArgs], {
    cwd: packageRoot,
    encoding: 'utf-8',
  });

  const output = (result.stdout.trim() || result.stderr.trim());
  if (!output) {
    throw new Error(`${label}: command produced no JSON output`);
  }

  let envelope;
  try {
    envelope = JSON.parse(output);
  } catch {
    throw new Error(`${label}: could not parse JSON output\n${output}`);
  }

  if (options.expectSuccess) {
    if (result.status !== 0) {
      throw new Error(`${label}: command exited with ${result.status}\n${output}`);
    }
    if (!envelope.ok) {
      throw new Error(`${label}: expected success envelope\n${output}`);
    }
    console.log(`PASS: ${label}`);
    return envelope.data;
  }

  if (result.status === 0) {
    throw new Error(`${label}: expected command failure but it succeeded`);
  }
  if (envelope.ok !== false) {
    throw new Error(`${label}: expected failure JSON envelope\n${output}`);
  }
  console.log(`PASS: ${label} (expected failure)`);
  return envelope.error;
}

function parseArgs(args) {
  const parsed = {
    workspace: undefined,
    keep: false,
  };

  for (let idx = 0; idx < args.length; idx++) {
    const token = args[idx];
    if (token === '--workspace') {
      parsed.workspace = args[idx + 1];
      idx += 1;
      continue;
    }
    if (token === '--keep') {
      parsed.keep = true;
      continue;
    }
  }

  return parsed;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
