// src/cloud/config.ts
import * as fs from "fs";

// src/cloud/paths.ts
import * as os from "os";
import * as path from "path";
var DEFAULT_HOME_DIR = ".clawvault";
var CONFIG_FILE = "config.json";
var SYNC_QUEUE_FILE = "sync-queue.json";
var TRACE_LOG_FILE = "traces.ndjson";
function getClawVaultHomeDir() {
  const override = process.env.CLAWVAULT_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), DEFAULT_HOME_DIR);
}
function getCloudConfigPath() {
  return path.join(getClawVaultHomeDir(), CONFIG_FILE);
}
function getSyncQueuePath() {
  return path.join(getClawVaultHomeDir(), SYNC_QUEUE_FILE);
}
function getTraceLogPath() {
  return path.join(getClawVaultHomeDir(), TRACE_LOG_FILE);
}

// src/cloud/config.ts
function ensureCloudDir() {
  const dir = getClawVaultHomeDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
function readCloudConfig() {
  const configPath = getCloudConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed ?? {};
  } catch {
    return {};
  }
}
function writeCloudConfig(config) {
  ensureCloudDir();
  const configPath = getCloudConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return config;
}
function updateCloudConfig(patch) {
  const current = readCloudConfig();
  const next = { ...current, ...patch };
  return writeCloudConfig(next);
}
function maskApiKey(apiKey) {
  if (!apiKey) return "(not set)";
  if (apiKey.length <= 8) return "***";
  const start = apiKey.slice(0, 4);
  const end = apiKey.slice(-4);
  return `${start}${"*".repeat(Math.max(4, apiKey.length - 8))}${end}`;
}
function getConfiguredCloudApiUrl(config) {
  const value = config?.cloudApiUrl || process.env.CLAWVAULT_CLOUD_API_URL;
  if (value && value.trim()) {
    return value.trim().replace(/\/+$/, "");
  }
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:4000";
  }
  return "https://api.clawvault.io";
}

// src/cloud/service.ts
import { randomUUID } from "crypto";

// src/cloud/client.ts
var CloudApiError = class extends Error {
  status;
  responseBody;
};
function parseRegisterResponse(payload) {
  const vaultId = payload?.vaultId ?? payload?.id ?? payload?.vault?.id;
  const orgSlug = payload?.orgSlug ?? payload?.org?.slug;
  if (!vaultId || typeof vaultId !== "string") {
    throw new Error("Cloud register response missing vault ID.");
  }
  return {
    vaultId,
    orgSlug: typeof orgSlug === "string" ? orgSlug : void 0,
    raw: payload
  };
}
async function requestJson(options, config) {
  const baseUrl = getConfiguredCloudApiUrl(config);
  const url = `${baseUrl}${options.path.startsWith("/") ? options.path : `/${options.path}`}`;
  const timeoutMs = options.timeoutMs ?? 1e4;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": options.apiKey
      },
      body: options.body ? JSON.stringify(options.body) : void 0,
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text();
      const err = new CloudApiError(
        `Cloud API request failed (${response.status}) at ${options.path}`
      );
      err.status = response.status;
      err.responseBody = body;
      throw err;
    }
    const text = await response.text();
    if (!text.trim()) {
      return {};
    }
    return JSON.parse(text);
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Cloud API request timed out after ${timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
function createCloudClient(config) {
  if (!config.cloudApiKey) {
    throw new Error("Cloud API key not configured. Run `clawvault config --cloud-key <key>`.");
  }
  return {
    async registerVault(input) {
      const payload = await requestJson({
        method: "POST",
        path: "/vaults/register",
        apiKey: config.cloudApiKey,
        body: {
          name: input.name,
          agentId: input.agentId
        }
      }, config);
      return parseRegisterResponse(payload);
    },
    async syncTraces(vaultId, traces) {
      return requestJson({
        method: "POST",
        path: `/vaults/${encodeURIComponent(vaultId)}/sync`,
        apiKey: config.cloudApiKey,
        body: { traces }
      }, config);
    }
  };
}

// src/cloud/queue.ts
import * as fs2 from "fs";
var EMPTY_QUEUE = {
  traces: [],
  updatedAt: (/* @__PURE__ */ new Date(0)).toISOString()
};
function ensureCloudDir2() {
  const dir = getClawVaultHomeDir();
  if (!fs2.existsSync(dir)) {
    fs2.mkdirSync(dir, { recursive: true });
  }
}
function readQueue() {
  const queuePath = getSyncQueuePath();
  if (!fs2.existsSync(queuePath)) {
    return { ...EMPTY_QUEUE };
  }
  try {
    const raw = fs2.readFileSync(queuePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.traces)) {
      return { ...EMPTY_QUEUE };
    }
    return {
      traces: parsed.traces,
      updatedAt: parsed.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch {
    return { ...EMPTY_QUEUE };
  }
}
function writeQueue(traces) {
  ensureCloudDir2();
  const next = {
    traces,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  fs2.writeFileSync(getSyncQueuePath(), JSON.stringify(next, null, 2));
  return next;
}
function enqueueTrace(trace) {
  const queue = readQueue();
  queue.traces.push(trace);
  return writeQueue(queue.traces);
}
function appendTraceLog(trace) {
  ensureCloudDir2();
  fs2.appendFileSync(getTraceLogPath(), `${JSON.stringify(trace)}
`);
}

// src/cloud/service.ts
function normalizeTrace(input) {
  return {
    localTraceId: input.localTraceId || randomUUID(),
    timestamp: input.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
    summary: input.summary,
    inputs: Array.isArray(input.inputs) ? input.inputs : [],
    policies: Array.isArray(input.policies) ? input.policies : [],
    exceptions: Array.isArray(input.exceptions) ? input.exceptions : [],
    outcome: input.outcome || {
      action: "unspecified",
      target: "unspecified",
      success: true,
      data: {}
    },
    entityRefs: Array.isArray(input.entityRefs) ? input.entityRefs : []
  };
}
function getSyncWindow(traces, options) {
  if (options.all) {
    return traces;
  }
  const limit = Math.max(1, options.limit ?? 10);
  return traces.slice(0, limit);
}
function setCloudApiKey(cloudKey) {
  const clean = cloudKey.trim();
  if (!clean) {
    throw new Error("Cloud API key cannot be empty.");
  }
  updateCloudConfig({ cloudApiKey: clean });
  return getCloudStatus();
}
function getCloudStatus() {
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
async function linkVaultToOrg(options) {
  if (!options.vaultName.trim()) {
    throw new Error("Vault name is required for org link.");
  }
  if (!options.agentId.trim()) {
    throw new Error("Agent ID is required for org link.");
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
async function syncQueuedTraces(options = {}) {
  const queue = readQueue();
  const config = readCloudConfig();
  const attemptedWindow = getSyncWindow(queue.traces, options);
  if (attemptedWindow.length === 0) {
    return {
      attempted: 0,
      synced: 0,
      remaining: 0,
      skippedReason: "empty-queue"
    };
  }
  if (!config.cloudApiKey || !config.cloudVaultId) {
    return {
      attempted: attemptedWindow.length,
      synced: 0,
      remaining: queue.traces.length,
      skippedReason: "cloud-not-configured"
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
async function emitTrace(input, syncNow = true) {
  const trace = normalizeTrace(input);
  appendTraceLog(trace);
  const queue = enqueueTrace(trace);
  let syncResult = {
    attempted: 0,
    synced: 0,
    remaining: queue.traces.length,
    skippedReason: "sync-disabled"
  };
  if (syncNow) {
    try {
      syncResult = await syncQueuedTraces({ all: false, limit: 25 });
    } catch {
      syncResult = {
        attempted: 0,
        synced: 0,
        remaining: readQueue().traces.length,
        skippedReason: "sync-failed"
      };
    }
  }
  return {
    trace,
    queueDepth: readQueue().traces.length,
    sync: syncResult
  };
}
async function autoSyncOnCheckpoint() {
  try {
    return await syncQueuedTraces({ all: false, limit: 10 });
  } catch {
    const remaining = readQueue().traces.length;
    return {
      attempted: 0,
      synced: 0,
      remaining,
      skippedReason: "sync-failed"
    };
  }
}
async function autoSyncOnHandoff() {
  try {
    return await syncQueuedTraces({ all: true });
  } catch {
    const remaining = readQueue().traces.length;
    return {
      attempted: 0,
      synced: 0,
      remaining,
      skippedReason: "sync-failed"
    };
  }
}

export {
  readCloudConfig,
  updateCloudConfig,
  setCloudApiKey,
  getCloudStatus,
  linkVaultToOrg,
  syncQueuedTraces,
  emitTrace,
  autoSyncOnCheckpoint,
  autoSyncOnHandoff
};
