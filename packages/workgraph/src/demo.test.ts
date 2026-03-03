import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapProductDemo } from './demo.js';
import { verifyHashChain, historyOf } from './ledger.js';
import { listTypes } from './registry.js';
import { list, read } from './store.js';
import { isWorkgraphWorkspace } from './workspace.js';

let workspacePath: string;

beforeEach(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-product-demo-'));
  fs.rmSync(workspacePath, { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(workspacePath, { recursive: true, force: true });
});

describe('demo bootstrap', () => {
  it('builds a fully-initialized standalone workspace with malleable primitives', () => {
    const result = bootstrapProductDemo(workspacePath, {
      name: 'Demo QA Workspace',
      commandCenterPath: 'ops/Command Center.md',
    });

    expect(result.workspacePath).toBe(path.resolve(workspacePath));
    expect(isWorkgraphWorkspace(workspacePath)).toBe(true);
    expect(result.customTypes).toEqual(['milestone', 'release-gate']);
    expect(result.generatedBases).toContain('.clawvault/bases/milestone.base');
    expect(result.generatedBases).toContain('.clawvault/bases/release-gate.base');

    const registryTypes = listTypes(workspacePath).map((typeDef) => typeDef.name);
    expect(registryTypes).toContain('milestone');
    expect(registryTypes).toContain('release-gate');

    const threads = list(workspacePath, 'thread');
    expect(threads).toHaveLength(4);
    expect(threads.every((thread) => thread.fields.status === 'done')).toBe(true);

    const releaseGate = read(workspacePath, result.customPrimitives.releaseGate);
    expect(releaseGate).not.toBeNull();
    expect(releaseGate?.fields.go_no_go).toBe('go');
    expect(releaseGate?.fields.status).toBe('ready');

    const commandCenterPath = path.join(workspacePath, result.commandCenterPath);
    expect(fs.existsSync(commandCenterPath)).toBe(true);
    const commandCenter = fs.readFileSync(commandCenterPath, 'utf-8');
    expect(commandCenter).toContain('# Workgraph Command Center');
    expect(commandCenter).toContain('## Recent Ledger Activity');

    const verify = verifyHashChain(workspacePath, { strict: true });
    expect(verify.ok).toBe(true);
    expect(verify.issues).toEqual([]);
    expect(verify.entries).toBeGreaterThan(0);

    const childHistory = historyOf(workspacePath, result.threads.children[1]);
    const childOps = new Set(childHistory.map((entry) => entry.op));
    expect(childOps).toContain('claim');
    expect(childOps).toContain('block');
    expect(childOps).toContain('unblock');
    expect(childOps).toContain('done');
  });

  it('throws if bootstrapping into an already-initialized workspace', () => {
    bootstrapProductDemo(workspacePath);
    expect(() => bootstrapProductDemo(workspacePath)).toThrow('already initialized');
  });
});
