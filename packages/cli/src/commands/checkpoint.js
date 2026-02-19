/**
 * Quick checkpoint command - fast state save for context death resilience
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
const CLAWVAULT_DIR = '.clawvault';
const CHECKPOINT_FILE = 'last-checkpoint.json';
const SESSION_STATE_FILE = 'session-state.json';
const DIRTY_DEATH_FLAG = 'dirty-death.flag';
const CHECKPOINT_HISTORY_DIR = 'checkpoints';
const CHECKPOINT_RETENTION_MAX_COUNT = 50;
const CHECKPOINT_RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let pendingCheckpoint = null;
let pendingData = null;
function ensureClawvaultDir(vaultPath) {
    const dir = path.join(vaultPath, CLAWVAULT_DIR);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
function readCheckpointHistoryEntries(historyDir) {
    const entries = [];
    const files = fs.readdirSync(historyDir).filter((entry) => entry.endsWith('.json'));
    for (const fileName of files) {
        const filePath = path.join(historyDir, fileName);
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                continue;
            }
            const timestamp = typeof parsed.timestamp === 'string'
                ? parsed.timestamp
                : '';
            const timestampMs = Date.parse(timestamp);
            if (Number.isNaN(timestampMs)) {
                continue;
            }
            entries.push({ filePath, timestampMs });
        }
        catch {
            // Ignore malformed history files; best-effort retention only.
        }
    }
    return entries.sort((left, right) => {
        if (right.timestampMs !== left.timestampMs) {
            return right.timestampMs - left.timestampMs;
        }
        return right.filePath.localeCompare(left.filePath);
    });
}
function pruneCheckpointHistory(historyDir, nowMs) {
    if (!fs.existsSync(historyDir)) {
        return;
    }
    const entries = readCheckpointHistoryEntries(historyDir);
    if (entries.length <= CHECKPOINT_RETENTION_MAX_COUNT) {
        return;
    }
    for (let index = CHECKPOINT_RETENTION_MAX_COUNT; index < entries.length; index += 1) {
        const ageMs = nowMs - entries[index].timestampMs;
        if (ageMs > CHECKPOINT_RETENTION_MAX_AGE_MS) {
            try {
                fs.unlinkSync(entries[index].filePath);
            }
            catch {
                // Best-effort pruning; writes should still succeed if cleanup fails.
            }
        }
    }
}
function writeCheckpointToDisk(dir, data) {
    const checkpointPath = path.join(dir, CHECKPOINT_FILE);
    fs.writeFileSync(checkpointPath, JSON.stringify(data, null, 2));
    const historyDir = path.join(dir, CHECKPOINT_HISTORY_DIR);
    fs.mkdirSync(historyDir, { recursive: true });
    const historyFileName = `${data.timestamp.replace(/[:.]/g, '-')}.json`;
    const historyPath = path.join(historyDir, historyFileName);
    fs.writeFileSync(historyPath, JSON.stringify(data, null, 2));
    pruneCheckpointHistory(historyDir, Date.now());
    const flagPath = path.join(dir, DIRTY_DEATH_FLAG);
    fs.writeFileSync(flagPath, data.timestamp);
}
function parseTokenEstimate(raw) {
    if (!raw)
        return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function loadSessionState(dir) {
    const sessionStatePath = path.join(dir, SESSION_STATE_FILE);
    if (!fs.existsSync(sessionStatePath))
        return null;
    try {
        return JSON.parse(fs.readFileSync(sessionStatePath, 'utf-8'));
    }
    catch {
        return null;
    }
}
function getEnvSessionState() {
    return {
        sessionKey: process.env.OPENCLAW_SESSION_KEY,
        model: process.env.OPENCLAW_MODEL,
        tokenEstimate: parseTokenEstimate(process.env.OPENCLAW_TOKEN_ESTIMATE || process.env.OPENCLAW_CONTEXT_TOKENS)
    };
}
function triggerUrgentWake(data) {
    const summary = [
        data.workingOn ? `Working on: ${data.workingOn}` : null,
        data.focus ? `Focus: ${data.focus}` : null,
        data.blocked ? `Blocked: ${data.blocked}` : null
    ].filter(Boolean).join(' | ');
    const text = summary
        ? `Urgent checkpoint saved. ${summary}`
        : 'Urgent checkpoint saved.';
    try {
        execFileSync('openclaw', ['gateway', 'wake', '--text', text, '--mode', 'now'], {
            stdio: 'inherit'
        });
    }
    catch (err) {
        if (err?.code === 'ENOENT') {
            throw new Error('Urgent wake failed: openclaw CLI not found.');
        }
        throw new Error(`Urgent wake failed: ${err?.message || 'unknown error'}`);
    }
}
export async function flush() {
    if (pendingCheckpoint) {
        clearTimeout(pendingCheckpoint);
        pendingCheckpoint = null;
    }
    if (!pendingData)
        return null;
    const { dir, data } = pendingData;
    pendingData = null;
    writeCheckpointToDisk(dir, data);
    return data;
}
export async function checkpoint(options) {
    const dir = ensureClawvaultDir(options.vaultPath);
    const data = {
        timestamp: new Date().toISOString(),
        workingOn: options.workingOn || null,
        focus: options.focus || null,
        blocked: options.blocked || null,
        urgent: options.urgent || false
    };
    const sessionState = loadSessionState(dir);
    const envState = getEnvSessionState();
    data.sessionId = sessionState?.sessionId;
    data.sessionKey = envState.sessionKey || sessionState?.sessionKey || sessionState?.sessionId;
    data.model = envState.model || sessionState?.model;
    data.tokenEstimate = envState.tokenEstimate ?? sessionState?.tokenEstimate;
    data.sessionStartedAt = sessionState?.startedAt;
    if (options.urgent) {
        if (pendingCheckpoint) {
            clearTimeout(pendingCheckpoint);
            pendingCheckpoint = null;
        }
        pendingData = null;
        writeCheckpointToDisk(dir, data);
        triggerUrgentWake(data);
    }
    else {
        // Debounce writes to avoid rapid write spam; last call wins.
        pendingData = { dir, data };
        if (pendingCheckpoint)
            clearTimeout(pendingCheckpoint);
        pendingCheckpoint = setTimeout(() => {
            void flush();
        }, 1000);
    }
    return data;
}
export async function clearDirtyFlag(vaultPath) {
    const flagPath = path.join(vaultPath, CLAWVAULT_DIR, DIRTY_DEATH_FLAG);
    if (fs.existsSync(flagPath)) {
        fs.unlinkSync(flagPath);
    }
}
// Alias for CLI ergonomics (`clawvault clean-exit`)
export async function cleanExit(vaultPath) {
    await clearDirtyFlag(vaultPath);
}
export async function checkDirtyDeath(vaultPath) {
    const dir = path.join(vaultPath, CLAWVAULT_DIR);
    const flagPath = path.join(dir, DIRTY_DEATH_FLAG);
    const checkpointPath = path.join(dir, CHECKPOINT_FILE);
    if (!fs.existsSync(flagPath)) {
        return { died: false, checkpoint: null, deathTime: null };
    }
    const deathTime = fs.readFileSync(flagPath, 'utf-8').trim();
    let checkpoint = null;
    if (fs.existsSync(checkpointPath)) {
        try {
            checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
        }
        catch {
            // Ignore parse errors
        }
    }
    return { died: true, checkpoint, deathTime };
}
export async function setSessionState(vaultPath, session) {
    const dir = ensureClawvaultDir(vaultPath);
    const sessionStatePath = path.join(dir, SESSION_STATE_FILE);
    const state = typeof session === 'string'
        ? { sessionId: session }
        : { ...session };
    if (!state.startedAt) {
        state.startedAt = new Date().toISOString();
    }
    fs.writeFileSync(sessionStatePath, JSON.stringify(state, null, 2));
}
//# sourceMappingURL=checkpoint.js.map