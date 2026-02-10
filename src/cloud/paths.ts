import * as os from 'os';
import * as path from 'path';

const DEFAULT_HOME_DIR = '.clawvault';
const CONFIG_FILE = 'config.json';
const SYNC_QUEUE_FILE = 'sync-queue.json';
const TRACE_LOG_FILE = 'traces.ndjson';

export function getClawVaultHomeDir(): string {
  const override = process.env.CLAWVAULT_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), DEFAULT_HOME_DIR);
}

export function getCloudConfigPath(): string {
  return path.join(getClawVaultHomeDir(), CONFIG_FILE);
}

export function getSyncQueuePath(): string {
  return path.join(getClawVaultHomeDir(), SYNC_QUEUE_FILE);
}

export function getTraceLogPath(): string {
  return path.join(getClawVaultHomeDir(), TRACE_LOG_FILE);
}
