#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

/**
 * Lightweight CLI contract checks for merge readiness.
 * These checks confirm both entrypoints boot and expose expected commands.
 */

const checks = [
  {
    name: 'clawvault help',
    command: 'node',
    args: ['bin/clawvault.js', '--help'],
    expectedSnippets: ['clawvault', 'init', 'context'],
  },
  {
    name: 'workgraph help',
    command: 'node',
    args: ['packages/workgraph/bin/workgraph.js', '--help'],
    expectedSnippets: ['workgraph', 'thread', 'ledger'],
  },
  {
    name: 'workgraph skill help',
    command: 'node',
    args: ['packages/workgraph/bin/workgraph.js', 'skill', '--help'],
    expectedSnippets: ['skill', 'write', 'promote'],
  },
];

let failed = false;

for (const check of checks) {
  const result = spawnSync(check.command, check.args, {
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const combined = `${stdout}\n${stderr}`;

  const missing = check.expectedSnippets.filter((snippet) => !combined.includes(snippet));
  const exitCode = result.status ?? 1;
  const ok = exitCode === 0 && missing.length === 0;

  if (!ok) {
    failed = true;
    console.error(`❌ ${check.name} failed`);
    console.error(`   exit=${exitCode}`);
    if (missing.length > 0) {
      console.error(`   missing snippets: ${missing.join(', ')}`);
    }
    if (stderr.trim().length > 0) {
      console.error(`   stderr: ${stderr.trim()}`);
    }
    continue;
  }

  console.log(`✅ ${check.name}`);
}

if (failed) {
  process.exit(1);
}

console.log('✅ CLI checks passed');
