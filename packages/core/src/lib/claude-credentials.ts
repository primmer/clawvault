import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface ClaudeOAuthCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms timestamp
}

const CLAUDE_CODE_SERVICE = 'Claude Code-credentials';
const CLAUDE_CODE_ACCOUNT = 'Claude Code';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TOKEN_REFRESH_URL = 'https://console.anthropic.com/v1/oauth/token';
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

export function readClaudeCliCredentials(opts?: { homeDir?: string }): ClaudeOAuthCredential | null {
  // Try macOS keychain first
  if (process.platform === 'darwin') {
    try {
      const raw = execFileSync(
        'security',
        ['find-generic-password', '-s', CLAUDE_CODE_SERVICE, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      const parsed = parseCredentialsJson(raw);
      if (parsed) return parsed;
    } catch {
      // fall through to file
    }
  }

  // Fallback: ~/.claude/.credentials.json
  const home = opts?.homeDir ?? homedir();
  const credFile = join(home, '.claude', '.credentials.json');
  if (!existsSync(credFile)) {
    return null;
  }
  try {
    const raw = readFileSync(credFile, 'utf8');
    return parseCredentialsJson(raw);
  } catch {
    return null;
  }
}

function parseCredentialsJson(raw: string): ClaudeOAuthCredential | null {
  try {
    const parsed = JSON.parse(raw) as { claudeAiOauth?: Partial<ClaudeOAuthCredential> };
    const oauth = parsed.claudeAiOauth;
    if (
      oauth &&
      typeof oauth.accessToken === 'string' &&
      typeof oauth.refreshToken === 'string' &&
      typeof oauth.expiresAt === 'number'
    ) {
      return {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt
      };
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export async function refreshClaudeOAuthToken(
  refreshToken: string,
  fetchImpl?: typeof fetch
): Promise<ClaudeOAuthCredential> {
  const f = fetchImpl ?? fetch;
  const response = await f(TOKEN_REFRESH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: OAUTH_CLIENT_ID,
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`OAuth token refresh failed (${response.status})`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };
}

export function writeClaudeCliCredentials(
  cred: ClaudeOAuthCredential,
  opts?: { homeDir?: string }
): void {
  const payload = JSON.stringify({ claudeAiOauth: cred });

  if (process.platform === 'darwin') {
    try {
      execFileSync(
        'security',
        ['add-generic-password', '-U', '-s', CLAUDE_CODE_SERVICE, '-a', CLAUDE_CODE_ACCOUNT, '-w', payload],
        { stdio: 'ignore' }
      );
      return;
    } catch {
      // fall through to file write
    }
  }

  const home = opts?.homeDir ?? homedir();
  const credFile = join(home, '.claude', '.credentials.json');
  writeFileSync(credFile, payload, 'utf8');
}

export async function resolveClaudeOAuthToken(opts?: {
  homeDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const cred = readClaudeCliCredentials(opts);
  if (!cred) {
    return null;
  }

  if (cred.expiresAt < Date.now() + EXPIRY_BUFFER_MS) {
    try {
      const refreshed = await refreshClaudeOAuthToken(cred.refreshToken, opts?.fetchImpl);
      writeClaudeCliCredentials(refreshed, opts);
      return refreshed.accessToken;
    } catch {
      // If refresh fails, return existing token and let the API call fail gracefully
      return cred.accessToken;
    }
  }

  return cred.accessToken;
}
