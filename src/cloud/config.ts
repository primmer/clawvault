import * as fs from 'fs';
import { CloudConfig } from './types.js';
import { getCloudConfigPath, getClawVaultHomeDir } from './paths.js';

function ensureCloudDir(): void {
  const dir = getClawVaultHomeDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readCloudConfig(): CloudConfig {
  const configPath = getCloudConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as CloudConfig;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function writeCloudConfig(config: CloudConfig): CloudConfig {
  ensureCloudDir();
  const configPath = getCloudConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return config;
}

export function updateCloudConfig(patch: Partial<CloudConfig>): CloudConfig {
  const current = readCloudConfig();
  const next = { ...current, ...patch };
  return writeCloudConfig(next);
}

export function maskApiKey(apiKey?: string): string {
  if (!apiKey) return '(not set)';
  if (apiKey.length <= 8) return '***';
  const start = apiKey.slice(0, 4);
  const end = apiKey.slice(-4);
  return `${start}${'*'.repeat(Math.max(4, apiKey.length - 8))}${end}`;
}

export function getConfiguredCloudApiUrl(config?: CloudConfig): string {
  const value = config?.cloudApiUrl || process.env.CLAWVAULT_CLOUD_API_URL;
  if (value && value.trim()) {
    return value.trim().replace(/\/+$/, '');
  }
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:4000';
  }
  return 'https://api.clawvault.io';
}
