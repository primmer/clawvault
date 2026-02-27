/**
 * Opinionated product-demo bootstrap for standalone workgraph CLI.
 */

import * as bases from './bases.js';
import * as commandCenter from './command-center.js';
import * as ledger from './ledger.js';
import * as registry from './registry.js';
import * as store from './store.js';
import * as thread from './thread.js';
import * as workspace from './workspace.js';
import type { PrimitiveInstance } from './types.js';

export interface BootstrapProductDemoOptions {
  name?: string;
  actor?: string;
  workerOne?: string;
  workerTwo?: string;
  commandCenterPath?: string;
}

export interface BootstrapProductDemoResult {
  workspacePath: string;
  commandCenterPath: string;
  seededTypes: string[];
  customTypes: string[];
  spaces: string[];
  threads: {
    parent: string;
    children: string[];
    completed: string[];
  };
  customPrimitives: {
    milestone: string;
    releaseGate: string;
  };
  generatedBases: string[];
  ledger: {
    ok: boolean;
    entries: number;
    lastHash: string;
  };
}

const DEFAULT_LEAD = 'agent-lead';
const DEFAULT_WORKER_ONE = 'agent-worker-1';
const DEFAULT_WORKER_TWO = 'agent-worker-2';

export function bootstrapProductDemo(
  targetPath: string,
  options: BootstrapProductDemoOptions = {},
): BootstrapProductDemoResult {
  const lead = options.actor ?? DEFAULT_LEAD;
  const workerOne = options.workerOne ?? DEFAULT_WORKER_ONE;
  const workerTwo = options.workerTwo ?? DEFAULT_WORKER_TWO;

  const initialized = workspace.initWorkspace(targetPath, {
    name: options.name ?? 'Standalone Workgraph Product Demo',
  });
  const workspacePath = initialized.workspacePath;

  defineDemoPrimitives(workspacePath, lead);
  bases.syncPrimitiveRegistryManifest(workspacePath);
  const generatedBases = bases.generateBasesFromPrimitiveRegistry(workspacePath, {
    includeNonCanonical: true,
  });

  const demoSpace = store.create(
    workspacePath,
    'space',
    {
      title: 'Standalone CLI Program',
      description: 'Execution lane for the standalone workgraph CLI release.',
      members: [lead, workerOne, workerTwo],
      tags: ['demo', 'release', 'workgraph'],
    },
    '# Standalone CLI Program\n\nShared lane for product-demo execution.',
    lead,
  );

  const parentThread = thread.createThread(
    workspacePath,
    'Ship standalone workgraph CLI',
    'Deliver a production-grade standalone CLI with a reproducible product walkthrough.',
    lead,
    {
      priority: 'high',
      space: demoSpace.path,
      tags: ['release', 'demo'],
    },
  );

  const decomposed = thread.decompose(
    workspacePath,
    parentThread.path,
    [
      {
        title: 'Harden CLI contract',
        goal: 'Validate command JSON envelopes and error semantics for automation.',
      },
      {
        title: 'Exercise multi-agent workspace',
        goal: 'Run claim/block/unblock/done lifecycle against realistic workspace state.',
      },
      {
        title: 'Record product walkthrough',
        goal: 'Capture end-to-end demo steps with ledger and command-center proof.',
      },
    ],
    lead,
  );

  const [contractThread, workspaceThread, walkthroughThread] = decomposed;
  if (!contractThread || !workspaceThread || !walkthroughThread) {
    throw new Error('Failed to create demo child threads');
  }

  // Encode deterministic sequencing for `thread next --claim` demo flows.
  store.update(workspacePath, workspaceThread.path, { deps: [contractThread.path] }, undefined, lead);
  store.update(workspacePath, walkthroughThread.path, { deps: [workspaceThread.path] }, undefined, lead);

  const milestone = store.create(
    workspacePath,
    'milestone',
    {
      title: 'Standalone CLI launch milestone',
      status: 'pending',
      target_date: '2026-04-01',
      thread_refs: [contractThread.path, workspaceThread.path, walkthroughThread.path],
    },
    '# Launch Milestone\n\nTracks readiness of the standalone CLI launch threads.',
    lead,
  );

  const releaseGate = store.create(
    workspacePath,
    'release-gate',
    {
      title: 'Standalone CLI release gate',
      owner: lead,
      go_no_go: 'pending',
      milestone_ref: milestone.path,
      thread_refs: [contractThread.path, workspaceThread.path, walkthroughThread.path],
    },
    '# Release Gate\n\nFinal go/no-go checkpoint for the standalone CLI.',
    lead,
  );

  runDemoLifecycle(
    workspacePath,
    lead,
    workerOne,
    workerTwo,
    parentThread.path,
    contractThread.path,
    workspaceThread.path,
    walkthroughThread.path,
  );

  store.update(
    workspacePath,
    releaseGate.path,
    {
      go_no_go: 'go',
      status: 'ready',
    },
    undefined,
    lead,
  );

  const commandCenterResult = commandCenter.generateCommandCenter(workspacePath, {
    actor: lead,
    outputPath: options.commandCenterPath ?? 'ops/Command Center.md',
    recentCount: 30,
  });

  const verification = ledger.verifyHashChain(workspacePath, { strict: true });
  if (!verification.ok) {
    throw new Error(`Ledger hash-chain verification failed: ${verification.issues.join('; ')}`);
  }

  return {
    workspacePath,
    commandCenterPath: commandCenterResult.outputPath,
    seededTypes: initialized.seededTypes,
    customTypes: ['milestone', 'release-gate'],
    spaces: [demoSpace.path],
    threads: {
      parent: parentThread.path,
      children: [contractThread.path, workspaceThread.path, walkthroughThread.path],
      completed: [contractThread.path, workspaceThread.path, walkthroughThread.path, parentThread.path],
    },
    customPrimitives: {
      milestone: milestone.path,
      releaseGate: releaseGate.path,
    },
    generatedBases: generatedBases.generated,
    ledger: {
      ok: verification.ok,
      entries: verification.entries,
      lastHash: verification.lastHash,
    },
  };
}

function defineDemoPrimitives(workspacePath: string, actor: string): void {
  registry.defineType(
    workspacePath,
    'milestone',
    'A release checkpoint bundling thread outcomes and dates.',
    {
      thread_refs: { type: 'list', default: [] },
      target_date: { type: 'date' },
      status: { type: 'string', default: 'pending' },
    },
    actor,
    'milestones',
  );

  registry.defineType(
    workspacePath,
    'release-gate',
    'Go/no-go coordination primitive for production launch decisions.',
    {
      owner: { type: 'string', required: true },
      go_no_go: { type: 'string', default: 'pending' },
      status: { type: 'string', default: 'collecting-evidence' },
      milestone_ref: { type: 'ref', required: true },
      thread_refs: { type: 'list', default: [] },
    },
    actor,
    'release-gates',
  );
}

function runDemoLifecycle(
  workspacePath: string,
  lead: string,
  workerOne: string,
  workerTwo: string,
  parentPath: string,
  contractPath: string,
  workspaceThreadPath: string,
  walkthroughPath: string,
): void {
  const claimOne = assertClaim(thread.claimNextReady(workspacePath, workerOne), contractPath);
  thread.done(
    workspacePath,
    claimOne.path,
    workerOne,
    'Validated JSON contract and CLI integration behavior across core commands.',
  );

  const claimTwo = assertClaim(thread.claimNextReady(workspacePath, workerTwo), workspaceThreadPath);
  thread.block(
    workspacePath,
    claimTwo.path,
    workerTwo,
    'external/demo-assets',
    'Waiting for final artifact template and narration alignment.',
  );
  thread.unblock(workspacePath, claimTwo.path, lead);
  thread.done(
    workspacePath,
    claimTwo.path,
    workerTwo,
    'Executed realistic multi-agent collaboration flow in a clean workspace.',
  );

  const claimThree = assertClaim(thread.claimNextReady(workspacePath, workerOne), walkthroughPath);
  thread.done(
    workspacePath,
    claimThree.path,
    workerOne,
    'Recorded walkthrough and captured ledger + command-center evidence.',
  );

  const claimParent = assertClaim(thread.claimNextReady(workspacePath, lead), parentPath);
  thread.done(
    workspacePath,
    claimParent.path,
    lead,
    'Standalone CLI shipped with reproducible product demo and verification artifacts.',
  );
}

function assertClaim(instance: PrimitiveInstance | null, expectedPath: string): PrimitiveInstance {
  if (!instance) {
    throw new Error(`Expected claimable thread ${expectedPath}, but queue was empty`);
  }
  if (instance.path !== expectedPath) {
    throw new Error(`Expected to claim ${expectedPath}, got ${instance.path}`);
  }
  return instance;
}
