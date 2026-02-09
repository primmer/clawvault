/**
 * ClawVault OpenClaw Hook
 * 
 * Provides automatic context death resilience:
 * - gateway:startup → detect context death, inject recovery info
 * - command:new → auto-checkpoint before session reset
 * - session:start → inject relevant context for first user prompt
 * 
 * SECURITY: Uses execFileSync (no shell) to prevent command injection
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const MAX_CONTEXT_RESULTS = 4;
const MAX_CONTEXT_PROMPT_LENGTH = 500;
const MAX_CONTEXT_SNIPPET_LENGTH = 220;

// Sanitize string for safe display (prevent prompt injection via control chars)
function sanitizeForDisplay(str) {
  if (typeof str !== 'string') return '';
  // Remove control characters, limit length, escape markdown
  return str
    .replace(/[\x00-\x1f\x7f]/g, '') // Remove control chars
    .replace(/[`*_~\[\]]/g, '\\$&')  // Escape markdown
    .slice(0, 200);                   // Limit length
}

// Sanitize prompt before passing to CLI command
function sanitizePromptForContext(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CONTEXT_PROMPT_LENGTH);
}

function extractTextFromMessage(message) {
  if (typeof message === 'string') return message;
  if (!message || typeof message !== 'object') return '';

  const content = message.content ?? message.text ?? message.message;
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }

  return '';
}

function isUserMessage(message) {
  if (typeof message === 'string') return true;
  if (!message || typeof message !== 'object') return false;
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const type = typeof message.type === 'string' ? message.type.toLowerCase() : '';
  return role === 'user' || role === 'human' || type === 'user';
}

function extractInitialPrompt(event) {
  const fromContext = sanitizePromptForContext(event?.context?.initialPrompt);
  if (fromContext) return fromContext;

  const candidates = [
    event?.context?.messages,
    event?.context?.initialMessages,
    event?.context?.history,
    event?.messages
  ];

  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const message of list) {
      if (!isUserMessage(message)) continue;
      const text = sanitizePromptForContext(extractTextFromMessage(message));
      if (text) return text;
    }
  }

  return '';
}

function truncateSnippet(snippet) {
  const safe = sanitizeForDisplay(snippet).replace(/\s+/g, ' ').trim();
  if (safe.length <= MAX_CONTEXT_SNIPPET_LENGTH) return safe;
  return `${safe.slice(0, MAX_CONTEXT_SNIPPET_LENGTH - 3).trimEnd()}...`;
}

function parseContextJson(output) {
  try {
    const parsed = JSON.parse(output);
    if (!parsed || !Array.isArray(parsed.context)) return [];

    return parsed.context
      .slice(0, MAX_CONTEXT_RESULTS)
      .map((entry) => ({
        title: sanitizeForDisplay(entry?.title || 'Untitled'),
        age: sanitizeForDisplay(entry?.age || 'unknown age'),
        snippet: truncateSnippet(entry?.snippet || '')
      }))
      .filter((entry) => entry.snippet);
  } catch {
    return [];
  }
}

function formatContextInjection(entries) {
  const lines = ['[ClawVault] Relevant context for this task:'];
  for (const entry of entries) {
    lines.push(`- ${entry.title} (${entry.age}): ${entry.snippet}`);
  }
  return lines.join('\n');
}

// Validate vault path - must be absolute and exist
function validateVaultPath(vaultPath) {
  if (!vaultPath || typeof vaultPath !== 'string') return null;
  
  // Resolve to absolute path
  const resolved = path.resolve(vaultPath);
  
  // Must be absolute
  if (!path.isAbsolute(resolved)) return null;
  
  // Must exist and be a directory
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }
  
  // Must contain .clawvault.json
  const configPath = path.join(resolved, '.clawvault.json');
  if (!fs.existsSync(configPath)) return null;
  
  return resolved;
}

// Find vault by walking up directories
function findVaultPath() {
  // Check env first
  if (process.env.CLAWVAULT_PATH) {
    return validateVaultPath(process.env.CLAWVAULT_PATH);
  }

  // Walk up from cwd
  let dir = process.cwd();
  const root = path.parse(dir).root;
  
  while (dir !== root) {
    const validated = validateVaultPath(dir);
    if (validated) return validated;
    
    // Also check memory/ subdirectory (OpenClaw convention)
    const memoryDir = path.join(dir, 'memory');
    const memoryValidated = validateVaultPath(memoryDir);
    if (memoryValidated) return memoryValidated;
    
    dir = path.dirname(dir);
  }
  
  return null;
}

// Run clawvault command safely (no shell)
function runClawvault(args) {
  try {
    // Use execFileSync to avoid shell injection
    // Arguments are passed as array, not interpolated into shell
    const output = execFileSync('clawvault', args, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Explicitly no shell
      shell: false
    });
    return { success: true, output: output.trim(), code: 0 };
  } catch (err) {
    return { 
      success: false, 
      output: err.stderr?.toString() || err.message || String(err),
      code: err.status || 1
    };
  }
}

// Parse recovery output safely
function parseRecoveryOutput(output) {
  if (!output || typeof output !== 'string') {
    return { hadDeath: false, workingOn: null };
  }
  
  const hadDeath = output.includes('Context death detected') || 
                   output.includes('died') || 
                   output.includes('⚠️');
  
  let workingOn = null;
  if (hadDeath) {
    const lines = output.split('\n');
    const workingOnLine = lines.find(l => l.toLowerCase().includes('working on'));
    if (workingOnLine) {
      const parts = workingOnLine.split(':');
      if (parts.length > 1) {
        workingOn = sanitizeForDisplay(parts.slice(1).join(':').trim());
      }
    }
  }
  
  return { hadDeath, workingOn };
}

// Handle gateway startup - check for context death
async function handleStartup(event) {
  const vaultPath = findVaultPath();
  if (!vaultPath) {
    console.log('[clawvault] No vault found, skipping recovery check');
    return;
  }

  console.log(`[clawvault] Checking for context death`);

  // Pass vault path as separate argument (not interpolated)
  const result = runClawvault(['recover', '--clear', '-v', vaultPath]);
  
  if (!result.success) {
    console.warn('[clawvault] Recovery check failed');
    return;
  }

  const { hadDeath, workingOn } = parseRecoveryOutput(result.output);
  
  if (hadDeath) {
    // Build safe alert message with sanitized content
    const alertParts = ['[ClawVault] Context death detected.'];
    if (workingOn) {
      alertParts.push(`Last working on: ${workingOn}`);
    }
    alertParts.push('Run `clawvault wake` for full recovery context.');
    
    const alertMsg = alertParts.join(' ');

    // Inject into event messages if available
    if (event.messages && Array.isArray(event.messages)) {
      event.messages.push(alertMsg);
    }
    
    console.warn('[clawvault] Context death detected, alert injected');
  } else {
    console.log('[clawvault] Clean startup - no context death');
  }
}

// Handle /new command - auto-checkpoint before reset
async function handleNew(event) {
  const vaultPath = findVaultPath();
  if (!vaultPath) {
    console.log('[clawvault] No vault found, skipping auto-checkpoint');
    return;
  }

  // Sanitize session info for checkpoint
  const sessionKey = typeof event.sessionKey === 'string' 
    ? event.sessionKey.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 100)
    : 'unknown';
  const source = typeof event.context?.commandSource === 'string'
    ? event.context.commandSource.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50)
    : 'cli';

  console.log('[clawvault] Auto-checkpoint before /new');

  // Pass each argument separately (no shell interpolation)
  const result = runClawvault([
    'checkpoint',
    '--working-on', `Session reset via /new from ${source}`,
    '--focus', `Pre-reset checkpoint, session: ${sessionKey}`,
    '-v', vaultPath
  ]);

  if (result.success) {
    console.log('[clawvault] Auto-checkpoint created');
  } else {
    console.warn('[clawvault] Auto-checkpoint failed');
  }
}

// Handle session start - inject dynamic context for first prompt
async function handleSessionStart(event) {
  const vaultPath = findVaultPath();
  if (!vaultPath) {
    console.log('[clawvault] No vault found, skipping context injection');
    return;
  }

  const prompt = extractInitialPrompt(event);
  if (!prompt) {
    console.log('[clawvault] No initial prompt, skipping context injection');
    return;
  }

  console.log('[clawvault] Fetching context for session start');

  const result = runClawvault([
    'context',
    prompt,
    '--format', 'json',
    '-v', vaultPath
  ]);

  if (!result.success) {
    console.warn('[clawvault] Context lookup failed');
    return;
  }

  const entries = parseContextJson(result.output);
  if (entries.length === 0) {
    console.log('[clawvault] No relevant context found for prompt');
    return;
  }

  if (event.messages && Array.isArray(event.messages)) {
    event.messages.push(formatContextInjection(entries));
    console.log(`[clawvault] Injected ${entries.length} context item(s)`);
  }
}

// Main handler - route events
const handler = async (event) => {
  try {
    if (event.type === 'gateway' && event.action === 'startup') {
      await handleStartup(event);
      return;
    }

    if (event.type === 'command' && event.action === 'new') {
      await handleNew(event);
      return;
    }

    if (event.type === 'session' && event.action === 'start') {
      await handleSessionStart(event);
      return;
    }
  } catch (err) {
    console.error('[clawvault] Hook error:', err.message || 'unknown error');
  }
};

export default handler;
