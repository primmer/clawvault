import fs from 'node:fs';
import path from 'node:path';

const BRIDGE_MARKER = 'clawvault-workgraph-bridge-v1';
const DEFAULT_CLAUDE_DIR = '.claude';

type JsonObject = Record<string, unknown>;

export interface ClaudeBridgeInstallOptions {
  projectPath: string;
  vaultPath: string;
  includeSessionEndHook?: boolean;
}

export interface ClaudeBridgeStatus {
  ok: boolean;
  settingsPath: string;
  issues: string[];
}

export interface ClaudeBridgeInstallResult {
  settingsPath: string;
  changed: boolean;
}

function resolveClaudeDir(projectPath: string): string {
  return path.join(normalizePathInput(projectPath), DEFAULT_CLAUDE_DIR);
}

export function resolveClaudeSettingsPath(projectPath: string): string {
  const claudeDir = resolveClaudeDir(projectPath);
  const localPath = path.join(claudeDir, 'settings.local.json');
  if (fs.existsSync(localPath)) return localPath;
  const defaultPath = path.join(claudeDir, 'settings.json');
  return defaultPath;
}

function readJson(filePath: string): JsonObject {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
    return {};
  } catch {
    return {};
  }
}

function writeJson(filePath: string, value: JsonObject): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function managedCommand(command: string, vaultPath: string): string {
  return `clawvault ${command} -v "${normalizePathInput(vaultPath)}" # ${BRIDGE_MARKER}`;
}

interface ClaudeHookAction {
  type: 'command';
  command: string;
}

interface ClaudeHookEntry {
  matcher: string;
  hooks: ClaudeHookAction[];
}

const MANAGED_CLAUDE_EVENTS = ['SessionStart', 'SessionEnd'] as const;
type ManagedClaudeEvent = typeof MANAGED_CLAUDE_EVENTS[number];

function normalizePathInput(value: string, fallbackPath: string = process.cwd()): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return path.resolve(trimmed || fallbackPath);
}

function coerceHookEntries(value: unknown): ClaudeHookEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ClaudeHookEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const matcher = typeof (entry as JsonObject).matcher === 'string'
      ? String((entry as JsonObject).matcher)
      : '*';
    const rawHooks = Array.isArray((entry as JsonObject).hooks)
      ? (entry as JsonObject).hooks as unknown[]
      : [];
    const hooks: ClaudeHookAction[] = rawHooks
      .filter((hook) => hook && typeof hook === 'object' && !Array.isArray(hook))
      .map((hook): ClaudeHookAction => ({
        type: 'command',
        command: String((hook as JsonObject).command || '')
      }))
      .filter((hook) => hook.command.trim().length > 0);
    entries.push({ matcher, hooks });
  }
  return entries;
}

function hasManagedCommand(entries: ClaudeHookEntry[], command: string): boolean {
  return entries.some((entry) => entry.hooks.some((hook) => hook.command === command));
}

function upsertManagedCommand(entries: ClaudeHookEntry[], command: string): ClaudeHookEntry[] {
  if (hasManagedCommand(entries, command)) return entries;
  return [
    ...entries,
    {
      matcher: '*',
      hooks: [{ type: 'command', command }]
    }
  ];
}

function removeManagedCommands(entries: ClaudeHookEntry[]): ClaudeHookEntry[] {
  return entries
    .map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((hook) => !hook.command.includes(BRIDGE_MARKER))
    }))
    .filter((entry) => entry.hooks.length > 0);
}

function requiredCommands(vaultPath: string, includeSessionEndHook: boolean): Record<string, string> {
  const commands: Record<string, string> = {
    SessionStart: managedCommand('resume-packet build --format markdown', vaultPath)
  };
  if (includeSessionEndHook) {
    commands.SessionEnd = managedCommand('observe --cron --min-new 1', vaultPath);
  }
  return commands;
}

function hasManagedBridgeHook(hooksRoot: JsonObject, eventName: ManagedClaudeEvent): boolean {
  const entries = coerceHookEntries(hooksRoot[eventName]);
  return entries.some((entry) => entry.hooks.some((hook) => hook.command.includes(BRIDGE_MARKER)));
}

export function installClaudeCodeBridge(options: ClaudeBridgeInstallOptions): ClaudeBridgeInstallResult {
  const settingsPath = resolveClaudeSettingsPath(options.projectPath);
  const settings = readJson(settingsPath);
  const hooksRoot = (settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks))
    ? settings.hooks as JsonObject
    : {};
  const includeSessionEndHook = options.includeSessionEndHook ?? true;

  let changed = false;
  const commands = requiredCommands(options.vaultPath, includeSessionEndHook);
  for (const eventName of MANAGED_CLAUDE_EVENTS) {
    const entries = coerceHookEntries(hooksRoot[eventName]);
    const withoutManaged = removeManagedCommands(entries);
    const command = commands[eventName];
    const nextEntries = command ? upsertManagedCommand(withoutManaged, command) : withoutManaged;
    if (JSON.stringify(entries) !== JSON.stringify(nextEntries)) {
      hooksRoot[eventName] = nextEntries;
      changed = true;
    }
  }

  const metadata = {
    marker: BRIDGE_MARKER,
    vaultPath: normalizePathInput(options.vaultPath),
    includeSessionEndHook,
    updatedAt: new Date().toISOString()
  };
  if (JSON.stringify(settings.clawvaultBridge ?? null) !== JSON.stringify(metadata)) {
    settings.clawvaultBridge = metadata;
    changed = true;
  }

  settings.hooks = hooksRoot;
  if (changed) {
    writeJson(settingsPath, settings);
  }

  return {
    settingsPath,
    changed
  };
}

export function verifyClaudeCodeBridge(projectPath: string): ClaudeBridgeStatus {
  const settingsPath = resolveClaudeSettingsPath(projectPath);
  const settings = readJson(settingsPath);
  const issues: string[] = [];
  const metadata = settings.clawvaultBridge;

  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    issues.push('Missing clawvaultBridge metadata block.');
  } else {
    const marker = (metadata as JsonObject).marker;
    if (marker !== BRIDGE_MARKER) {
      issues.push('Bridge marker mismatch in metadata.');
    }
  }

  const hooksRoot = (settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks))
    ? settings.hooks as JsonObject
    : {};
  if (!hasManagedBridgeHook(hooksRoot, 'SessionStart')) {
    issues.push('Missing managed SessionStart bridge hook.');
  }

  const includeSessionEndHook = metadata
    && typeof metadata === 'object'
    && !Array.isArray(metadata)
    && (metadata as JsonObject).includeSessionEndHook !== false;
  if (includeSessionEndHook && !hasManagedBridgeHook(hooksRoot, 'SessionEnd')) {
    issues.push('Missing managed SessionEnd bridge hook.');
  }

  return {
    ok: issues.length === 0,
    settingsPath,
    issues
  };
}

export function uninstallClaudeCodeBridge(projectPath: string): ClaudeBridgeInstallResult {
  const settingsPath = resolveClaudeSettingsPath(projectPath);
  const settings = readJson(settingsPath);
  const hooksRoot = (settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks))
    ? settings.hooks as JsonObject
    : {};
  let changed = false;

  for (const eventName of MANAGED_CLAUDE_EVENTS) {
    const entries = coerceHookEntries(hooksRoot[eventName]);
    const nextEntries = removeManagedCommands(entries);
    if (JSON.stringify(entries) !== JSON.stringify(nextEntries)) {
      hooksRoot[eventName] = nextEntries;
      changed = true;
    }
  }

  if (settings.clawvaultBridge !== undefined) {
    delete settings.clawvaultBridge;
    changed = true;
  }

  settings.hooks = hooksRoot;
  if (changed) {
    writeJson(settingsPath, settings);
  }

  return {
    settingsPath,
    changed
  };
}
