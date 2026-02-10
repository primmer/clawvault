import * as fs from 'fs';
import * as path from 'path';
import {
  autoSyncOnCheckpoint,
  autoSyncOnHandoff,
  emitTrace,
  getCloudStatus,
  linkVaultToOrg,
  setCloudApiKey,
  syncQueuedTraces
} from '../cloud/service.js';
import { DecisionTraceInput } from '../cloud/types.js';
import { readCloudConfig, updateCloudConfig } from '../cloud/config.js';

interface OrgLinkOptions {
  vaultPath: string;
  agentId?: string;
  orgSlug?: string;
}

interface TraceEmitOptions {
  summary?: string;
  traceFile?: string;
  traceJson?: string;
  stdin?: boolean;
  sync?: boolean;
  trace?: DecisionTraceInput;
}

function resolveVaultName(vaultPath: string): string {
  const resolved = path.resolve(vaultPath);
  const configPath = path.join(resolved, '.clawvault.json');
  if (!fs.existsSync(configPath)) {
    return path.basename(resolved);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { name?: string };
    return parsed.name || path.basename(resolved);
  } catch {
    return path.basename(resolved);
  }
}

function parseTracePayload(options: TraceEmitOptions): DecisionTraceInput {
  let payload: DecisionTraceInput | null = null;

  if (options.trace) {
    payload = options.trace;
  } else if (options.traceJson) {
    payload = JSON.parse(options.traceJson) as DecisionTraceInput;
  } else if (options.traceFile) {
    payload = JSON.parse(fs.readFileSync(options.traceFile, 'utf-8')) as DecisionTraceInput;
  } else if (options.stdin) {
    const raw = fs.readFileSync(0, 'utf-8');
    payload = JSON.parse(raw) as DecisionTraceInput;
  }

  if (!payload) {
    if (!options.summary) {
      throw new Error('Trace summary is required (use --summary, --trace-json, --trace-file, or --stdin).');
    }
    return { summary: options.summary };
  }

  if (!payload.summary && options.summary) {
    payload.summary = options.summary;
  }
  if (!payload.summary) {
    throw new Error('Trace payload must include summary.');
  }
  return payload;
}

export async function cloudConfigCommand(options: {
  cloudKey?: string;
  cloudApiUrl?: string;
}): Promise<ReturnType<typeof getCloudStatus>> {
  if (!options.cloudKey && !options.cloudApiUrl) {
    return getCloudStatus();
  }

  if (options.cloudKey) {
    setCloudApiKey(options.cloudKey);
  }

  if (options.cloudApiUrl) {
    updateCloudConfig({ cloudApiUrl: options.cloudApiUrl.trim() });
  }

  return getCloudStatus();
}

export async function orgLinkCommand(options: OrgLinkOptions): Promise<{
  vaultName: string;
  vaultId: string;
  orgSlug?: string;
}> {
  const vaultName = resolveVaultName(options.vaultPath);
  const agentId = options.agentId || process.env.OPENCLAW_AGENT_ID || 'agent-local';
  const result = await linkVaultToOrg({
    vaultName,
    agentId,
    orgSlug: options.orgSlug
  });

  return {
    vaultName,
    vaultId: result.vaultId,
    orgSlug: options.orgSlug || result.orgSlug
  };
}

export async function orgStatusCommand(): Promise<{
  configured: boolean;
  apiKeySet: boolean;
  vaultIdSet: boolean;
  orgSlug?: string;
  queueDepth: number;
  cloudApiUrl?: string;
}> {
  const status = getCloudStatus();
  const config = readCloudConfig();

  return {
    configured: status.configured,
    apiKeySet: Boolean(config.cloudApiKey),
    vaultIdSet: Boolean(config.cloudVaultId),
    orgSlug: config.cloudOrgSlug,
    queueDepth: status.queueDepth,
    cloudApiUrl: status.cloudApiUrl
  };
}

export async function cloudSyncCommand(options: {
  all?: boolean;
  limit?: number;
} = {}): Promise<Awaited<ReturnType<typeof syncQueuedTraces>>> {
  return syncQueuedTraces({
    all: options.all,
    limit: options.limit
  });
}

export async function traceEmitCommand(options: TraceEmitOptions): Promise<Awaited<ReturnType<typeof emitTrace>>> {
  const payload = parseTracePayload(options);
  return emitTrace(payload, options.sync !== false);
}

export async function autoSyncCheckpointCommand(): Promise<Awaited<ReturnType<typeof autoSyncOnCheckpoint>>> {
  return autoSyncOnCheckpoint();
}

export async function autoSyncHandoffCommand(): Promise<Awaited<ReturnType<typeof autoSyncOnHandoff>>> {
  return autoSyncOnHandoff();
}
