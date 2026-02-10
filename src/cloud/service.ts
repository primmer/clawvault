import { randomUUID } from 'crypto';
import {
  CloudSyncResult,
  DecisionTrace,
  DecisionTraceInput,
  OrgLinkResult
} from './types.js';
import { createCloudClient } from './client.js';
import {
  getConfiguredCloudApiUrl,
  maskApiKey,
  readCloudConfig,
  updateCloudConfig
} from './config.js';
import { appendTraceLog, enqueueTrace, readQueue, writeQueue } from './queue.js';

export interface CloudStatus {
  configured: boolean;
  cloudApiKeyMasked: string;
  cloudVaultId?: string;
  cloudOrgSlug?: string;
  cloudApiUrl?: string;
  queueDepth: number;
}

export interface EmitTraceResult {
  trace: DecisionTrace;
  queueDepth: number;
  sync: CloudSyncResult;
}

function normalizeTrace(input: DecisionTraceInput): DecisionTrace {
  return {
    localTraceId: input.localTraceId || randomUUID(),
    timestamp: input.timestamp || new Date().toISOString(),
    summary: input.summary,
    inputs: Array.isArray(input.inputs) ? input.inputs : [],
    policies: Array.isArray(input.policies) ? input.policies : [],
    exceptions: Array.isArray(input.exceptions) ? input.exceptions : [],
    outcome: input.outcome || {
      action: 'unspecified',
      target: 'unspecified',
      success: true,
      data: {}
    },
    entityRefs: Array.isArray(input.entityRefs) ? input.entityRefs : []
  };
}

function getSyncWindow(
  traces: DecisionTrace[],
  options: { all?: boolean; limit?: number }
): DecisionTrace[] {
  if (options.all) {
    return traces;
  }
  const limit = Math.max(1, options.limit ?? 10);
  return traces.slice(0, limit);
}

export function setCloudApiKey(cloudKey: string): CloudStatus {
  const clean = cloudKey.trim();
  if (!clean) {
    throw new Error('Cloud API key cannot be empty.');
  }
  updateCloudConfig({ cloudApiKey: clean });
  return getCloudStatus();
}

export function getCloudStatus(): CloudStatus {
  const config = readCloudConfig();
  const queue = readQueue();
  const configured = Boolean(config.cloudApiKey && config.cloudVaultId);
  return {
    configured,
    cloudApiKeyMasked: maskApiKey(config.cloudApiKey),
    cloudVaultId: config.cloudVaultId,
    cloudOrgSlug: config.cloudOrgSlug,
    cloudApiUrl: getConfiguredCloudApiUrl(config),
    queueDepth: queue.traces.length
  };
}

export async function linkVaultToOrg(options: {
  vaultName: string;
  agentId: string;
  orgSlug?: string;
}): Promise<OrgLinkResult> {
  if (!options.vaultName.trim()) {
    throw new Error('Vault name is required for org link.');
  }
  if (!options.agentId.trim()) {
    throw new Error('Agent ID is required for org link.');
  }

  const config = readCloudConfig();
  const client = createCloudClient(config);
  const result = await client.registerVault({
    name: options.vaultName.trim(),
    agentId: options.agentId.trim()
  });

  updateCloudConfig({
    cloudVaultId: result.vaultId,
    cloudOrgSlug: options.orgSlug || result.orgSlug || config.cloudOrgSlug
  });

  return result;
}

export async function syncQueuedTraces(options: {
  all?: boolean;
  limit?: number;
} = {}): Promise<CloudSyncResult> {
  const queue = readQueue();
  const config = readCloudConfig();
  const attemptedWindow = getSyncWindow(queue.traces, options);

  if (attemptedWindow.length === 0) {
    return {
      attempted: 0,
      synced: 0,
      remaining: 0,
      skippedReason: 'empty-queue'
    };
  }

  if (!config.cloudApiKey || !config.cloudVaultId) {
    return {
      attempted: attemptedWindow.length,
      synced: 0,
      remaining: queue.traces.length,
      skippedReason: 'cloud-not-configured'
    };
  }

  const client = createCloudClient(config);
  await client.syncTraces(config.cloudVaultId, attemptedWindow);

  const remaining = queue.traces.slice(attemptedWindow.length);
  writeQueue(remaining);
  return {
    attempted: attemptedWindow.length,
    synced: attemptedWindow.length,
    remaining: remaining.length
  };
}

export async function emitTrace(input: DecisionTraceInput, syncNow: boolean = true): Promise<EmitTraceResult> {
  const trace = normalizeTrace(input);
  appendTraceLog(trace);
  const queue = enqueueTrace(trace);

  let syncResult: CloudSyncResult = {
    attempted: 0,
    synced: 0,
    remaining: queue.traces.length,
    skippedReason: 'sync-disabled'
  };

  if (syncNow) {
    try {
      syncResult = await syncQueuedTraces({ all: false, limit: 25 });
    } catch {
      syncResult = {
        attempted: 0,
        synced: 0,
        remaining: readQueue().traces.length,
        skippedReason: 'sync-failed'
      };
    }
  }

  return {
    trace,
    queueDepth: readQueue().traces.length,
    sync: syncResult
  };
}

export async function autoSyncOnCheckpoint(): Promise<CloudSyncResult> {
  try {
    return await syncQueuedTraces({ all: false, limit: 10 });
  } catch {
    const remaining = readQueue().traces.length;
    return {
      attempted: 0,
      synced: 0,
      remaining,
      skippedReason: 'sync-failed'
    };
  }
}

export async function autoSyncOnHandoff(): Promise<CloudSyncResult> {
  try {
    return await syncQueuedTraces({ all: true });
  } catch {
    const remaining = readQueue().traces.length;
    return {
      attempted: 0,
      synced: 0,
      remaining,
      skippedReason: 'sync-failed'
    };
  }
}
