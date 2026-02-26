import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadPrimitiveRegistry } from './primitive-registry.js';
import {
  allowedWritersForPrimitive,
  isWorkgraphWriter,
  type WorkgraphWriter
} from './writer-policy.js';

export const WORKGRAPH_EVENT_ACTIONS = [
  'create',
  'update',
  'transition',
  'link',
  'archive',
  'resume_packet_generated',
  'continuity_transition'
] as const;

export type WorkgraphEventAction = typeof WORKGRAPH_EVENT_ACTIONS[number];

export interface WorkgraphEventInput {
  primitive: string;
  primitiveId: string;
  action: WorkgraphEventAction;
  writer: WorkgraphWriter;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

export interface WorkgraphEvent extends WorkgraphEventInput {
  eventId: string;
  timestamp: string;
  payloadHash: string;
}

type WriterPolicyIndex = Map<string, Set<WorkgraphWriter>>;

function isWorkgraphEventAction(value: string): value is WorkgraphEventAction {
  return (WORKGRAPH_EVENT_ACTIONS as readonly string[]).includes(value);
}

function buildCanonicalPrimitiveSet(vaultPath?: string): Set<string> {
  const registry = vaultPath
    ? loadPrimitiveRegistry({ vaultPath })
    : loadPrimitiveRegistry();
  const canonical = new Set<string>();
  for (const entry of Object.values(registry.primitives)) {
    if (!entry.canonical) continue;
    canonical.add(entry.primitive);
  }
  return canonical;
}

let cachedDefaultCanonicalPrimitives: Set<string> | undefined;

function getDefaultCanonicalPrimitives(): Set<string> {
  if (!cachedDefaultCanonicalPrimitives) {
    cachedDefaultCanonicalPrimitives = buildCanonicalPrimitiveSet();
  }
  return cachedDefaultCanonicalPrimitives;
}

function buildWriterPolicyIndex(vaultPath: string, canonicalPrimitives: Set<string>): WriterPolicyIndex {
  const index: WriterPolicyIndex = new Map();
  for (const primitive of canonicalPrimitives) {
    index.set(primitive, new Set(allowedWritersForPrimitive(primitive, { vaultPath })));
  }
  return index;
}

function isCanonicalPrimitiveForVault(
  primitive: string,
  canonicalPrimitives?: Set<string>
): boolean {
  return (canonicalPrimitives ?? getDefaultCanonicalPrimitives()).has(primitive);
}

function normalizeCanonicalPrimitiveInput(value: string, canonicalPrimitives?: Set<string>): string {
  const normalized = value.trim().toLowerCase();
  if (!isCanonicalPrimitiveForVault(normalized, canonicalPrimitives)) {
    throw new Error(`Unsupported workgraph event primitive: ${value}`);
  }
  return normalized;
}

function normalizeEventActionInput(value: string): WorkgraphEventAction {
  const normalized = value.trim();
  if (!isWorkgraphEventAction(normalized)) {
    throw new Error(`Unsupported workgraph event action: ${value}`);
  }
  return normalized;
}

function normalizeEventWriterInput(value: string): WorkgraphWriter {
  const normalized = value.trim();
  if (!isWorkgraphWriter(normalized)) {
    throw new Error(`Unsupported workgraph event writer: ${value}`);
  }
  return normalized;
}

function normalizePrimitiveIdInput(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('workgraph event primitiveId is required.');
  }
  return normalized;
}

function normalizeEventPayload(
  payload: WorkgraphEventInput['payload']
): WorkgraphEventInput['payload'] {
  if (payload === undefined) return undefined;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('workgraph event payload must be an object when provided.');
  }
  return payload;
}

function normalizeIdempotencyKey(value: string): string {
  return value.trim();
}

export interface AppendWorkgraphEventResult {
  duplicate: boolean;
  event: WorkgraphEvent;
}

interface IdempotencyIndex {
  [idempotencyKey: string]: {
    eventId: string;
    timestamp: string;
  };
}

interface ReadWorkgraphEventsOptions {
  primitive?: string;
  primitiveId?: string;
  action?: WorkgraphEventAction;
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
  newestFirst?: boolean;
}

const WORKGRAPH_LEDGER_ROOT = ['.clawvault', 'ledger', 'workgraph'];
const EVENTS_ROOT = [...WORKGRAPH_LEDGER_ROOT, 'events'];
const IDEMPOTENCY_INDEX_FILE = [...WORKGRAPH_LEDGER_ROOT, 'idempotency-index.json'];

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeIndexEntry(value: unknown): { eventId: string; timestamp: string } | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const eventId = (value as { eventId?: unknown }).eventId;
  const timestamp = (value as { timestamp?: unknown }).timestamp;
  if (typeof eventId !== 'string' || !eventId.trim()) {
    return undefined;
  }
  if (typeof timestamp !== 'string' || !timestamp.trim()) {
    return undefined;
  }

  return {
    eventId: eventId.trim(),
    timestamp: timestamp.trim()
  };
}

function normalizeIdempotencyIndex(value: unknown): IdempotencyIndex {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const normalized: IdempotencyIndex = {};
  for (const [rawKey, rawEntry] of Object.entries(value)) {
    const idempotencyKey = normalizeIdempotencyKey(rawKey);
    if (!idempotencyKey) continue;
    const entry = normalizeIndexEntry(rawEntry);
    if (!entry) continue;
    normalized[idempotencyKey] = entry;
  }
  return normalized;
}

function loadIdempotencyIndex(vaultPath: string): IdempotencyIndex {
  const indexPath = path.join(vaultPath, ...IDEMPOTENCY_INDEX_FILE);
  if (!fs.existsSync(indexPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return normalizeIdempotencyIndex(parsed);
  } catch {
    return {};
  }
}

function saveIdempotencyIndex(vaultPath: string, index: IdempotencyIndex): void {
  const indexPath = path.join(vaultPath, ...IDEMPOTENCY_INDEX_FILE);
  ensureParentDir(indexPath);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

function buildPayloadHash(payload: WorkgraphEventInput['payload']): string {
  const stable = JSON.stringify(payload ?? {});
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function buildEventIdSeed(
  idempotencyKey: string,
  primitive: string,
  primitiveId: string,
  action: string,
  payloadHash: string
): string {
  return `${idempotencyKey}:${primitive}:${primitiveId}:${action}:${payloadHash}`;
}

function buildEventId(
  idempotencyKey: string,
  primitive: string,
  primitiveId: string,
  action: string,
  payloadHash: string
): string {
  return crypto
    .createHash('sha256')
    .update(buildEventIdSeed(idempotencyKey, primitive, primitiveId, action, payloadHash))
    .digest('hex');
}

function normalizeStoredEvent(
  value: unknown,
  canonicalPrimitives?: Set<string>,
  writerPolicyIndex?: WriterPolicyIndex
): WorkgraphEvent | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const primitive = typeof record.primitive === 'string' ? record.primitive.trim() : '';
  const primitiveId = typeof record.primitiveId === 'string' ? record.primitiveId.trim() : '';
  const action = typeof record.action === 'string' ? record.action.trim() : '';
  const writer = typeof record.writer === 'string' ? record.writer.trim() : '';
  const idempotencyKeyRaw = typeof record.idempotencyKey === 'string' ? record.idempotencyKey : '';
  const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyRaw);
  const timestampRaw = typeof record.timestamp === 'string' ? record.timestamp : '';
  const payloadHash = typeof record.payloadHash === 'string' ? record.payloadHash.trim() : '';
  const eventId = typeof record.eventId === 'string' ? record.eventId.trim() : '';

  if (!primitive || !primitiveId || !action || !writer || !idempotencyKey || !payloadHash || !eventId) {
    return null;
  }
  if (!isCanonicalPrimitiveForVault(primitive, canonicalPrimitives)) {
    return null;
  }
  if (!isWorkgraphEventAction(action)) {
    return null;
  }
  if (!isWorkgraphWriter(writer)) {
    return null;
  }
  if (writerPolicyIndex) {
    const allowedWriters = writerPolicyIndex.get(primitive);
    if (!allowedWriters || !allowedWriters.has(writer)) {
      return null;
    }
  }

  const parsedTimestampMs = parseTimestampMs(timestampRaw);
  if (parsedTimestampMs === undefined) return null;

  const payloadCandidate = record.payload;
  if (payloadCandidate !== undefined && (typeof payloadCandidate !== 'object' || payloadCandidate === null || Array.isArray(payloadCandidate))) {
    return null;
  }
  const payload = payloadCandidate as Record<string, unknown> | undefined;

  const expectedPayloadHash = buildPayloadHash(payload);
  if (payloadHash !== expectedPayloadHash) {
    return null;
  }

  const expectedEventId = buildEventId(idempotencyKey, primitive, primitiveId, action, payloadHash);
  if (eventId !== expectedEventId) {
    return null;
  }

  return {
    primitive,
    primitiveId,
    action,
    writer,
    idempotencyKey,
    payload,
    timestamp: new Date(parsedTimestampMs).toISOString(),
    payloadHash,
    eventId
  };
}

function resolveEventDatePath(vaultPath: string, timestamp: string): string {
  const when = new Date(timestamp);
  const year = String(when.getUTCFullYear());
  const month = String(when.getUTCMonth() + 1).padStart(2, '0');
  const day = String(when.getUTCDate()).padStart(2, '0');
  return path.join(vaultPath, ...EVENTS_ROOT, year, month, `${day}.jsonl`);
}

function readEventByIdFromFile(
  filePath: string,
  eventId: string,
  canonicalPrimitives?: Set<string>,
  writerPolicyIndex?: WriterPolicyIndex
): WorkgraphEvent | null {
  const events = readJsonlLines(filePath, canonicalPrimitives, writerPolicyIndex);
  return events.find((event) => event.eventId === eventId) ?? null;
}

function readJsonlLines(
  filePath: string,
  canonicalPrimitives?: Set<string>,
  writerPolicyIndex?: WriterPolicyIndex
): WorkgraphEvent[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];
  const events: WorkgraphEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const normalized = normalizeStoredEvent(JSON.parse(line), canonicalPrimitives, writerPolicyIndex);
      if (normalized) {
        events.push(normalized);
      }
    } catch {
      // Ignore malformed lines to keep ledger append-only and resilient.
    }
  }
  return events;
}

function parseTimestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeEventTimestamp(timestamp: string | undefined): string {
  if (!timestamp) {
    return new Date().toISOString();
  }
  const parsedMs = parseTimestampMs(timestamp);
  if (parsedMs === undefined) {
    throw new Error(`Invalid workgraph event timestamp: ${timestamp}`);
  }
  return new Date(parsedMs).toISOString();
}

function normalizeReadLimit(limit: number | undefined): number | undefined {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return undefined;
  }
  const normalized = Math.floor(limit);
  if (normalized <= 0) return 0;
  return normalized;
}

function normalizePrimitiveFilter(
  value: string | undefined,
  canonicalPrimitives?: Set<string>
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!isCanonicalPrimitiveForVault(normalized, canonicalPrimitives)) return undefined;
  return normalized;
}

function normalizeActionFilter(value: string | undefined): WorkgraphEventAction | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!isWorkgraphEventAction(normalized)) return undefined;
  return normalized;
}

function normalizePrimitiveIdFilter(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function assertWriterAllowedForPrimitive(
  writerPolicyIndex: WriterPolicyIndex,
  primitive: string,
  writer: WorkgraphWriter
): void {
  const allowedWriters = writerPolicyIndex.get(primitive);
  if (!allowedWriters || !allowedWriters.has(writer)) {
    throw new Error(
      `Writer "${writer}" is not allowed to append workgraph events for canonical primitive "${primitive}".`
    );
  }
}

export function buildWorkgraphEvent(
  input: WorkgraphEventInput,
  options: { canonicalPrimitives?: Set<string> } = {}
): WorkgraphEvent {
  const timestamp = normalizeEventTimestamp(input.timestamp);
  const primitive = normalizeCanonicalPrimitiveInput(input.primitive, options.canonicalPrimitives);
  const primitiveId = normalizePrimitiveIdInput(input.primitiveId);
  const action = normalizeEventActionInput(input.action);
  const writer = normalizeEventWriterInput(input.writer);
  const payload = normalizeEventPayload(input.payload);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const payloadHash = buildPayloadHash(payload);
  const eventId = buildEventId(idempotencyKey, primitive, primitiveId, action, payloadHash);

  return {
    ...input,
    primitive,
    primitiveId,
    action,
    writer,
    payload,
    idempotencyKey,
    timestamp,
    payloadHash,
    eventId
  };
}

export function appendWorkgraphEvent(vaultPath: string, input: WorkgraphEventInput): AppendWorkgraphEventResult {
  const canonicalPrimitives = buildCanonicalPrimitiveSet(vaultPath);
  const writerPolicyIndex = buildWriterPolicyIndex(vaultPath, canonicalPrimitives);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) {
    throw new Error('idempotencyKey is required for workgraph event ledger append.');
  }

  const event = buildWorkgraphEvent({
    ...input,
    idempotencyKey
  }, {
    canonicalPrimitives
  });
  assertWriterAllowedForPrimitive(writerPolicyIndex, event.primitive, event.writer);
  const index = loadIdempotencyIndex(vaultPath);
  const existing = index[event.idempotencyKey];
  if (existing) {
    const existingEvent = findEventById(
      vaultPath,
      existing.eventId,
      existing.timestamp,
      canonicalPrimitives,
      writerPolicyIndex
    );
    if (existingEvent) {
      if (existingEvent.eventId !== event.eventId) {
        throw new Error(
          `Idempotency key conflict for ${event.idempotencyKey}: existing event does not match append payload.`
        );
      }
      return {
        duplicate: true,
        event: existingEvent
      };
    }
  }

  const destination = resolveEventDatePath(vaultPath, event.timestamp);
  ensureParentDir(destination);
  fs.appendFileSync(destination, `${JSON.stringify(event)}\n`, 'utf-8');
  index[event.idempotencyKey] = {
    eventId: event.eventId,
    timestamp: event.timestamp
  };
  saveIdempotencyIndex(vaultPath, index);

  return {
    duplicate: false,
    event
  };
}

function listWorkgraphEventFiles(vaultPath: string, newestFirst: boolean = false): string[] {
  const root = path.join(vaultPath, ...EVENTS_ROOT);
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }
  const sorted = files.sort();
  return newestFirst ? sorted.reverse() : sorted;
}

export function findEventById(
  vaultPath: string,
  eventId: string,
  timestampHint?: string,
  canonicalPrimitives?: Set<string>,
  writerPolicyIndex?: WriterPolicyIndex
): WorkgraphEvent | null {
  const effectiveCanonicalPrimitives = canonicalPrimitives ?? buildCanonicalPrimitiveSet(vaultPath);
  const effectiveWriterPolicyIndex = writerPolicyIndex ?? buildWriterPolicyIndex(vaultPath, effectiveCanonicalPrimitives);
  const hintedTimestampMs = parseTimestampMs(timestampHint);
  if (hintedTimestampMs !== undefined) {
    const hintedFile = resolveEventDatePath(vaultPath, new Date(hintedTimestampMs).toISOString());
    const hintedMatch = readEventByIdFromFile(
      hintedFile,
      eventId,
      effectiveCanonicalPrimitives,
      effectiveWriterPolicyIndex
    );
    if (hintedMatch) return hintedMatch;
  }

  const files = listWorkgraphEventFiles(vaultPath);
  for (const file of files) {
    const match = readEventByIdFromFile(file, eventId, effectiveCanonicalPrimitives, effectiveWriterPolicyIndex);
    if (match) return match;
  }
  return null;
}

export function readWorkgraphEvents(
  vaultPath: string,
  options: ReadWorkgraphEventsOptions = {}
): WorkgraphEvent[] {
  const canonicalPrimitives = buildCanonicalPrimitiveSet(vaultPath);
  const writerPolicyIndex = buildWriterPolicyIndex(vaultPath, canonicalPrimitives);
  const limit = normalizeReadLimit(options.limit);
  if (limit === 0) {
    return [];
  }

  const newestFirst = options.newestFirst === true;
  const primitiveFilter = normalizePrimitiveFilter(options.primitive, canonicalPrimitives);
  const actionFilter = normalizeActionFilter(options.action);
  const primitiveIdFilter = normalizePrimitiveIdFilter(options.primitiveId);

  if (options.primitive !== undefined && primitiveFilter === undefined) {
    return [];
  }
  if (options.action !== undefined && actionFilter === undefined) {
    return [];
  }
  if (options.primitiveId !== undefined && primitiveIdFilter === undefined) {
    return [];
  }

  const fromTimestampMs = parseTimestampMs(options.fromTimestamp);
  const toTimestampUpperBoundMs = parseTimestampMs(options.toTimestamp);
  const files = listWorkgraphEventFiles(vaultPath, newestFirst);
  const collected: WorkgraphEvent[] = [];

  for (const file of files) {
    const events = readJsonlLines(file, canonicalPrimitives, writerPolicyIndex);
    const orderedEvents = newestFirst ? [...events].reverse() : events;
    for (const event of orderedEvents) {
      if (primitiveFilter && event.primitive !== primitiveFilter) continue;
      if (primitiveIdFilter && event.primitiveId !== primitiveIdFilter) continue;
      if (actionFilter && event.action !== actionFilter) continue;
      if (fromTimestampMs !== undefined || toTimestampUpperBoundMs !== undefined) {
        const eventTimestampMs = parseTimestampMs(event.timestamp);
        if (eventTimestampMs === undefined) continue;
        if (fromTimestampMs !== undefined && eventTimestampMs < fromTimestampMs) continue;
        if (toTimestampUpperBoundMs !== undefined && eventTimestampMs > toTimestampUpperBoundMs) continue;
      }

      collected.push(event);
      if (typeof limit === 'number' && collected.length >= limit) {
        return collected;
      }
    }
  }

  return collected;
}
