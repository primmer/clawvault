import {
  autoSyncOnCheckpoint,
  autoSyncOnHandoff,
  emitTrace,
  getCloudStatus,
  linkVaultToOrg,
  readCloudConfig,
  setCloudApiKey,
  syncQueuedTraces,
  updateCloudConfig
} from "../chunk-BBPSJL6H.js";

// src/commands/cloud.ts
import * as fs from "fs";
import * as path from "path";
function resolveVaultName(vaultPath) {
  const resolved = path.resolve(vaultPath);
  const configPath = path.join(resolved, ".clawvault.json");
  if (!fs.existsSync(configPath)) {
    return path.basename(resolved);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return parsed.name || path.basename(resolved);
  } catch {
    return path.basename(resolved);
  }
}
function parseTracePayload(options) {
  let payload = null;
  if (options.trace) {
    payload = options.trace;
  } else if (options.traceJson) {
    payload = JSON.parse(options.traceJson);
  } else if (options.traceFile) {
    payload = JSON.parse(fs.readFileSync(options.traceFile, "utf-8"));
  } else if (options.stdin) {
    const raw = fs.readFileSync(0, "utf-8");
    payload = JSON.parse(raw);
  }
  if (!payload) {
    if (!options.summary) {
      throw new Error("Trace summary is required (use --summary, --trace-json, --trace-file, or --stdin).");
    }
    return { summary: options.summary };
  }
  if (!payload.summary && options.summary) {
    payload.summary = options.summary;
  }
  if (!payload.summary) {
    throw new Error("Trace payload must include summary.");
  }
  return payload;
}
async function cloudConfigCommand(options) {
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
async function orgLinkCommand(options) {
  const vaultName = resolveVaultName(options.vaultPath);
  const agentId = options.agentId || process.env.OPENCLAW_AGENT_ID || "agent-local";
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
async function orgStatusCommand() {
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
async function cloudSyncCommand(options = {}) {
  return syncQueuedTraces({
    all: options.all,
    limit: options.limit
  });
}
async function traceEmitCommand(options) {
  const payload = parseTracePayload(options);
  return emitTrace(payload, options.sync !== false);
}
async function autoSyncCheckpointCommand() {
  return autoSyncOnCheckpoint();
}
async function autoSyncHandoffCommand() {
  return autoSyncOnHandoff();
}
export {
  autoSyncCheckpointCommand,
  autoSyncHandoffCommand,
  cloudConfigCommand,
  cloudSyncCommand,
  orgLinkCommand,
  orgStatusCommand,
  traceEmitCommand
};
