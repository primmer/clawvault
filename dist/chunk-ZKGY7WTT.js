import {
  getSessionFilePath,
  getSessionsDir,
  loadSessionsStore
} from "./chunk-HRLWZGMA.js";

// src/commands/session-recap.ts
import * as fs from "fs";
import * as path from "path";
var DEFAULT_LIMIT = 15;
var MAX_LIMIT = 50;
var READ_CHUNK_SIZE = 64 * 1024;
var MAX_TURN_TEXT_LENGTH = 420;
var MAX_TOTAL_TEXT_LENGTH = 12e3;
var SESSION_KEY_PATTERN = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/;
var AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;
function sanitizeSessionKey(input) {
  const sessionKey = input.trim();
  if (!SESSION_KEY_PATTERN.test(sessionKey)) {
    throw new Error("Invalid session key. Expected format: agent:<agentId>:<scope>");
  }
  return sessionKey;
}
function sanitizeAgentId(input) {
  const agentId = input.trim();
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new Error('Invalid agent ID. Use letters, numbers, "_" or "-".');
  }
  return agentId;
}
function parseAgentIdFromSessionKey(sessionKey) {
  const match = /^agent:([^:]+):/.exec(sessionKey);
  if (!match?.[1]) return null;
  return sanitizeAgentId(match[1]);
}
function resolveAgentId(sessionKey, explicitAgentId) {
  if (explicitAgentId) {
    return sanitizeAgentId(explicitAgentId);
  }
  const fromSessionKey = parseAgentIdFromSessionKey(sessionKey);
  if (fromSessionKey) return fromSessionKey;
  const fromEnv = process.env.OPENCLAW_AGENT_ID;
  if (fromEnv) return sanitizeAgentId(fromEnv);
  return "clawdious";
}
function normalizeLimit(limit) {
  if (limit === void 0 || Number.isNaN(limit)) return DEFAULT_LIMIT;
  const parsed = Math.floor(limit);
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}
function isPathInside(parentPath, candidatePath) {
  const normalizedParent = parentPath.endsWith(path.sep) ? parentPath : `${parentPath}${path.sep}`;
  return candidatePath.startsWith(normalizedParent);
}
function resolveSafeTranscriptPath(agentId, sessionId, sessionFile) {
  const sessionsDir = getSessionsDir(agentId);
  if (!fs.existsSync(sessionsDir)) {
    throw new Error(`Sessions directory not found for agent "${agentId}".`);
  }
  const sessionsDirRealPath = fs.realpathSync(sessionsDir);
  const candidatePaths = [];
  if (typeof sessionFile === "string" && sessionFile.trim()) {
    candidatePaths.push(path.resolve(sessionFile));
  }
  candidatePaths.push(getSessionFilePath(agentId, sessionId));
  for (const candidatePath of candidatePaths) {
    if (path.extname(candidatePath).toLowerCase() !== ".jsonl") continue;
    if (!fs.existsSync(candidatePath)) continue;
    let candidateRealPath = "";
    try {
      candidateRealPath = fs.realpathSync(candidatePath);
    } catch {
      continue;
    }
    if (!isPathInside(sessionsDirRealPath, candidateRealPath)) {
      continue;
    }
    const stat = fs.statSync(candidateRealPath);
    if (!stat.isFile()) continue;
    return candidateRealPath;
  }
  throw new Error(`No valid transcript found for session "${sessionId}".`);
}
function getSessionStoreEntry(agentId, sessionKey) {
  const store = loadSessionsStore(agentId);
  if (!store) {
    throw new Error(`Could not load sessions store for agent "${agentId}".`);
  }
  const entry = store[sessionKey];
  if (!entry) {
    throw new Error(`Session key not found: ${sessionKey}`);
  }
  if (typeof entry.sessionId !== "string" || !entry.sessionId.trim()) {
    throw new Error(`Invalid session mapping for "${sessionKey}" (missing sessionId).`);
  }
  return entry;
}
function sanitizeText(input) {
  return input.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
}
function truncateText(input, maxLength) {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
function extractTextFromContent(content) {
  if (typeof content === "string") {
    const cleaned = sanitizeText(content);
    return truncateText(cleaned, MAX_TURN_TEXT_LENGTH);
  }
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (typeof part === "string") {
        const cleaned2 = sanitizeText(part);
        if (cleaned2) parts.push(cleaned2);
        continue;
      }
      if (!part || typeof part !== "object") continue;
      const block = part;
      const blockType = typeof block.type === "string" ? block.type.toLowerCase() : "";
      if (blockType.includes("tool") || blockType.includes("thinking") || blockType.includes("reason")) {
        continue;
      }
      const blockText = typeof block.text === "string" ? block.text : typeof block.content === "string" && blockType.includes("text") ? block.content : "";
      const cleaned = sanitizeText(blockText);
      if (cleaned) parts.push(cleaned);
    }
    return truncateText(parts.join(" "), MAX_TURN_TEXT_LENGTH);
  }
  return "";
}
function parseTurnFromLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const entry = parsed;
  if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") {
    return null;
  }
  const message = entry.message;
  const role = typeof message.role === "string" ? message.role.toLowerCase() : "";
  if (role !== "user" && role !== "assistant") return null;
  const text = extractTextFromContent(message.content);
  if (!text) return null;
  return { role, text };
}
function applyOutputBudget(turns) {
  let remaining = MAX_TOTAL_TEXT_LENGTH;
  const selected = [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (remaining <= 0) break;
    const current = turns[i];
    let text = current.text;
    if (text.length > remaining) {
      if (remaining < 16) break;
      text = truncateText(text, remaining);
    }
    selected.push({ role: current.role, text });
    remaining -= text.length;
  }
  return selected.reverse();
}
function readRecentTurnsFromTranscript(filePath, limit) {
  if (limit <= 0) return [];
  const fileHandle = fs.openSync(filePath, "r");
  const collected = [];
  let remainder = "";
  try {
    let position = fs.fstatSync(fileHandle).size;
    while (position > 0 && collected.length < limit) {
      const readSize = Math.min(READ_CHUNK_SIZE, position);
      position -= readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      fs.readSync(fileHandle, buffer, 0, readSize, position);
      const chunk = buffer.toString("utf-8");
      const text = chunk + remainder;
      const lines = text.split("\n");
      remainder = lines.shift() ?? "";
      for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
        if (collected.length >= limit) break;
        const turn = parseTurnFromLine(lines[lineIndex]);
        if (turn) collected.push(turn);
      }
    }
    if (position === 0 && remainder && collected.length < limit) {
      const turn = parseTurnFromLine(remainder);
      if (turn) collected.push(turn);
    }
  } finally {
    fs.closeSync(fileHandle);
  }
  return applyOutputBudget(collected.reverse());
}
function toSessionLabel(sessionKey, agentId) {
  const normalizedPrefix = `agent:${agentId}:`;
  if (sessionKey.startsWith(normalizedPrefix)) {
    return sessionKey.slice(normalizedPrefix.length) || sessionKey;
  }
  const parts = sessionKey.split(":");
  if (parts[0] === "agent" && parts.length > 2) {
    return parts.slice(2).join(":");
  }
  return sessionKey;
}
function formatSessionRecapMarkdown(result) {
  let output = `## Session Recap: ${result.sessionLabel}

`;
  output += `### Recent Conversation (last ${result.count} messages)
`;
  if (result.messages.length === 0) {
    output += "_No recent user/assistant messages found._\n";
    return output.trimEnd();
  }
  for (const message of result.messages) {
    const label = message.role === "user" ? "User" : "Assistant";
    output += `**${label}:** ${message.text}

`;
  }
  return output.trimEnd();
}
async function buildSessionRecap(sessionKeyInput, options = {}) {
  const sessionKey = sanitizeSessionKey(sessionKeyInput);
  const agentId = resolveAgentId(sessionKey, options.agentId);
  const limit = normalizeLimit(options.limit);
  const entry = getSessionStoreEntry(agentId, sessionKey);
  const sessionId = String(entry.sessionId).trim();
  const transcriptPath = resolveSafeTranscriptPath(agentId, sessionId, entry.sessionFile);
  const messages = readRecentTurnsFromTranscript(transcriptPath, limit);
  const result = {
    sessionKey,
    sessionLabel: toSessionLabel(sessionKey, agentId),
    agentId,
    sessionId,
    transcriptPath,
    generated: (/* @__PURE__ */ new Date()).toISOString(),
    count: messages.length,
    messages,
    markdown: ""
  };
  result.markdown = formatSessionRecapMarkdown(result);
  return result;
}
async function sessionRecapCommand(sessionKey, options = {}) {
  const result = await buildSessionRecap(sessionKey, options);
  const format = options.format ?? "markdown";
  if (format === "json") {
    console.log(JSON.stringify({
      sessionKey: result.sessionKey,
      sessionLabel: result.sessionLabel,
      agentId: result.agentId,
      sessionId: result.sessionId,
      generated: result.generated,
      count: result.count,
      messages: result.messages
    }, null, 2));
    return;
  }
  console.log(result.markdown);
}

export {
  formatSessionRecapMarkdown,
  buildSessionRecap,
  sessionRecapCommand
};
