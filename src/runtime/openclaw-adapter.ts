import type { RuntimeAdapter, RuntimeEvent, RuntimeEventKind } from './types.js';

interface OpenClawRawEvent {
  type?: string;
  action?: string;
  event?: string;
  eventName?: string;
  name?: string;
  hook?: string;
  trigger?: string;
  timestamp?: string | number;
  sessionKey?: string;
  context?: Record<string, unknown>;
  [key: string]: unknown;
}

const SEPARATOR_RE = /[./]/g;
const UNIX_SECONDS_THRESHOLD = 1_000_000_000_000;

function normalizeToken(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(SEPARATOR_RE, ':');
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function detectEventToken(event: OpenClawRawEvent): string {
  const aliasCandidates = [
    normalizeToken(event.type && event.action ? `${event.type}:${event.action}` : ''),
    normalizeToken(event.event),
    normalizeToken(event.eventName),
    normalizeToken(event.name),
    normalizeToken(event.hook),
    normalizeToken(event.trigger)
  ];

  for (const candidate of aliasCandidates) {
    if (candidate) return candidate;
  }
  return '';
}

function toKind(token: string): RuntimeEventKind {
  if (token === 'gateway:startup') return 'startup';
  if (token === 'gateway:heartbeat' || token === 'session:heartbeat') return 'heartbeat';
  if (token === 'session:start') return 'session_start';
  if (token === 'command:new') return 'session_new';
  if (token === 'command:reset') return 'session_reset';
  if (token === 'compaction:memoryflush' || token === 'context:compaction') return 'compaction';
  if (token === 'cron:weekly') return 'weekly';
  return 'unknown';
}

function toTimestamp(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const timestampMs = Math.abs(raw) < UNIX_SECONDS_THRESHOLD ? raw * 1000 : raw;
    return new Date(timestampMs).toISOString();
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return toTimestamp(numeric);
      }
    }
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

export function normalizeOpenClawEvent(input: OpenClawRawEvent): RuntimeEvent[] {
  const token = detectEventToken(input);
  const sessionKey = normalizeOptionalString(input.sessionKey)
    ?? normalizeOptionalString(input.context?.sessionKey);

  return [
    {
      kind: toKind(token),
      source: 'openclaw',
      eventName: token || 'unknown',
      timestamp: toTimestamp(input.timestamp ?? input.context?.timestamp),
      sessionKey,
      payload: input as Record<string, unknown>
    }
  ];
}

export const openclawRuntimeAdapter: RuntimeAdapter<OpenClawRawEvent> = {
  normalizeEvent: normalizeOpenClawEvent
};
