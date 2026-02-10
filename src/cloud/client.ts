import { DecisionTrace, OrgLinkResult } from './types.js';
import { CloudConfig } from './types.js';
import { getConfiguredCloudApiUrl } from './config.js';

export interface CloudClient {
  registerVault(input: { name: string; agentId: string }): Promise<OrgLinkResult>;
  syncTraces(vaultId: string, traces: DecisionTrace[]): Promise<unknown>;
}

interface RequestOptions {
  method: 'POST' | 'GET';
  path: string;
  apiKey: string;
  body?: unknown;
  timeoutMs?: number;
}

class CloudApiError extends Error {
  status?: number;
  responseBody?: string;
}

function parseRegisterResponse(payload: any): OrgLinkResult {
  const vaultId = payload?.vaultId ?? payload?.id ?? payload?.vault?.id;
  const orgSlug = payload?.orgSlug ?? payload?.org?.slug;

  if (!vaultId || typeof vaultId !== 'string') {
    throw new Error('Cloud register response missing vault ID.');
  }

  return {
    vaultId,
    orgSlug: typeof orgSlug === 'string' ? orgSlug : undefined,
    raw: payload
  };
}

async function requestJson<T>(options: RequestOptions, config: CloudConfig): Promise<T> {
  const baseUrl = getConfiguredCloudApiUrl(config);
  const url = `${baseUrl}${options.path.startsWith('/') ? options.path : `/${options.path}`}`;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': options.apiKey
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
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
      return {} as T;
    }
    return JSON.parse(text) as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Cloud API request timed out after ${timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function createCloudClient(config: CloudConfig): CloudClient {
  if (!config.cloudApiKey) {
    throw new Error('Cloud API key not configured. Run `clawvault config --cloud-key <key>`.');
  }

  return {
    async registerVault(input: { name: string; agentId: string }): Promise<OrgLinkResult> {
      const payload = await requestJson<any>({
        method: 'POST',
        path: '/vaults/register',
        apiKey: config.cloudApiKey!,
        body: {
          name: input.name,
          agentId: input.agentId
        }
      }, config);
      return parseRegisterResponse(payload);
    },
    async syncTraces(vaultId: string, traces: DecisionTrace[]): Promise<unknown> {
      return requestJson<unknown>({
        method: 'POST',
        path: `/vaults/${encodeURIComponent(vaultId)}/sync`,
        apiKey: config.cloudApiKey!,
        body: { traces }
      }, config);
    }
  };
}
