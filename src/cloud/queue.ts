import * as fs from 'fs';
import { DecisionTrace, QueueFile } from './types.js';
import { getClawVaultHomeDir, getSyncQueuePath, getTraceLogPath } from './paths.js';

const EMPTY_QUEUE: QueueFile = {
  traces: [],
  updatedAt: new Date(0).toISOString()
};

function ensureCloudDir(): void {
  const dir = getClawVaultHomeDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readQueue(): QueueFile {
  const queuePath = getSyncQueuePath();
  if (!fs.existsSync(queuePath)) {
    return { ...EMPTY_QUEUE };
  }

  try {
    const raw = fs.readFileSync(queuePath, 'utf-8');
    const parsed = JSON.parse(raw) as QueueFile;
    if (!parsed || !Array.isArray(parsed.traces)) {
      return { ...EMPTY_QUEUE };
    }
    return {
      traces: parsed.traces,
      updatedAt: parsed.updatedAt || new Date().toISOString()
    };
  } catch {
    return { ...EMPTY_QUEUE };
  }
}

export function writeQueue(traces: DecisionTrace[]): QueueFile {
  ensureCloudDir();
  const next: QueueFile = {
    traces,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(getSyncQueuePath(), JSON.stringify(next, null, 2));
  return next;
}

export function enqueueTrace(trace: DecisionTrace): QueueFile {
  const queue = readQueue();
  queue.traces.push(trace);
  return writeQueue(queue.traces);
}

export function appendTraceLog(trace: DecisionTrace): void {
  ensureCloudDir();
  fs.appendFileSync(getTraceLogPath(), `${JSON.stringify(trace)}\n`);
}
