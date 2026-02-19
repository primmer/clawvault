import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { appendWorkgraphEvent } from './event-ledger.js';
import { applyPrimitiveDefaults, buildPrimitiveSchemaContract, validatePrimitivePayload } from './schema-contract.js';
import { assertCanonicalWriteAllowed, type WorkgraphWriter } from './writer-policy.js';
import { getPrimitiveRegistryEntry } from './primitive-registry.js';

type WritablePrimitive = string;

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function normalizeRequiredTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Title must be a string.');
  }
  const normalized = normalizeTitle(value);
  if (!normalized) {
    throw new Error('Title cannot be empty.');
  }
  return normalized;
}

function toSlug(title: string): string {
  return normalizeTitle(title)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function defaultStorageDirForPrimitive(primitive: string): string {
  return `${primitive}s`;
}

function primitiveDirectory(vaultPath: string, primitive: WritablePrimitive): string {
  const registryEntry = getPrimitiveRegistryEntry(primitive, { vaultPath });
  const configuredDirectory = registryEntry?.storageDir ?? defaultStorageDirForPrimitive(primitive);
  return path.join(path.resolve(vaultPath), configuredDirectory);
}

function ensurePrimitiveDirectory(vaultPath: string, primitive: WritablePrimitive): string {
  const directory = primitiveDirectory(vaultPath, primitive);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function buildPrimitiveId(primitive: WritablePrimitive, slug: string): string {
  return `${primitive}/${slug}`;
}

function buildValidationMessage(errors: ReturnType<typeof validatePrimitivePayload>): string {
  return errors.map((error) => `${error.field}:${error.code}`).join(', ');
}

function sanitizePatchFrontmatter(frontmatter: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => value !== undefined)
  );
}

function sanitizePersistedFrontmatter(frontmatter: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => value !== undefined && value !== null)
  );
}

function applyFrontmatterPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    next[key] = value;
  }
  return next;
}

function readMarkdownRecord(filePath: string, primitive: WritablePrimitive): WorkgraphPrimitiveRecord {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);
    const title = typeof parsed.data.title === 'string' && parsed.data.title.trim()
      ? parsed.data.title
      : path.basename(filePath, '.md');
    const slug = path.basename(filePath, '.md');
    const frontmatter = {
      ...(parsed.data as Record<string, unknown>),
      type: primitive,
      primitive,
      id: buildPrimitiveId(primitive, slug)
    };
    return {
      primitive,
      slug,
      id: buildPrimitiveId(primitive, slug),
      title,
      path: filePath,
      frontmatter,
      content: parsed.content
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${primitive} record at ${filePath}: ${message}`);
  }
}

function readMarkdownRecordOrNull(filePath: string, primitive: WritablePrimitive): WorkgraphPrimitiveRecord | null {
  try {
    return readMarkdownRecord(filePath, primitive);
  } catch {
    return null;
  }
}

function sortRecordsByUpdated(records: WorkgraphPrimitiveRecord[]): WorkgraphPrimitiveRecord[] {
  const toMs = (value: unknown): number => {
    const parsed = Date.parse(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...records].sort((left, right) => {
    const leftTime = toMs(left.frontmatter.updated ?? left.frontmatter.created);
    const rightTime = toMs(right.frontmatter.updated ?? right.frontmatter.created);
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return left.slug.localeCompare(right.slug);
  });
}

function normalizeComparableString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export interface WorkgraphPrimitiveRecord {
  primitive: WritablePrimitive;
  slug: string;
  id: string;
  title: string;
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface CreateWorkgraphPrimitiveInput {
  primitive: WritablePrimitive;
  title: string;
  frontmatter?: Record<string, unknown>;
  content?: string;
  writer?: WorkgraphWriter;
  policyGateId?: string;
  idempotencyKey?: string;
}

export interface UpdateWorkgraphPrimitiveInput {
  primitive: WritablePrimitive;
  slug: string;
  patch: Record<string, unknown>;
  writer?: WorkgraphWriter;
  policyGateId?: string;
  idempotencyKey?: string;
}

export interface ListWorkgraphPrimitiveOptions {
  status?: string;
  owner?: string;
  project?: string;
}

function assertPrimitiveSupported(vaultPath: string, primitive: string): WritablePrimitive {
  const normalized = primitive.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Primitive name is required.');
  }
  if (normalized === 'memory_event') {
    throw new Error('memory_event is observer-managed and not writable through canonical primitive commands.');
  }
  const registryEntry = getPrimitiveRegistryEntry(normalized, { vaultPath });
  if (!registryEntry?.canonical) {
    throw new Error(`Unsupported writable primitive: ${primitive}`);
  }
  return normalized;
}

export function createWorkgraphPrimitive(
  vaultPath: string,
  input: CreateWorkgraphPrimitiveInput
): WorkgraphPrimitiveRecord {
  const primitive = assertPrimitiveSupported(vaultPath, input.primitive);
  const writer = input.writer ?? 'cli';
  const policyGateId = input.policyGateId ?? `${primitive}:create`;
  assertCanonicalWriteAllowed({
    primitive,
    writer,
    policyGate: {
      gateId: policyGateId,
      approved: true
    },
    vaultPath
  });

  const slug = toSlug(input.title);
  if (!slug) {
    throw new Error('Unable to derive slug from title. Provide a non-empty title.');
  }

  const directory = ensurePrimitiveDirectory(vaultPath, primitive);
  const filePath = path.join(directory, `${slug}.md`);
  if (fs.existsSync(filePath)) {
    throw new Error(`Primitive already exists: ${primitive}/${slug}`);
  }

  const now = new Date();
  const schema = buildPrimitiveSchemaContract(primitive, { vaultPath });
  const baseFrontmatter = {
    ...input.frontmatter,
    title: normalizeRequiredTitle(input.title),
    type: primitive,
    primitive,
    id: buildPrimitiveId(primitive, slug)
  } as Record<string, unknown>;
  if (schema.fields.updated) {
    baseFrontmatter.updated = now.toISOString();
  }
  if (primitive === 'run' && !baseFrontmatter.idempotency_key) {
    baseFrontmatter.idempotency_key = `run:manual:${slug}`;
  }
  const hydrated = applyPrimitiveDefaults(schema, baseFrontmatter, now);
  const validationErrors = validatePrimitivePayload(schema, hydrated, { mode: 'create' });
  if (validationErrors.length > 0) {
    throw new Error(`Invalid ${primitive} frontmatter: ${buildValidationMessage(validationErrors)}`);
  }

  const sanitized = sanitizePersistedFrontmatter(hydrated);
  fs.writeFileSync(filePath, matter.stringify(input.content ?? '', sanitized), 'utf-8');
  appendWorkgraphEvent(vaultPath, {
    primitive,
    primitiveId: buildPrimitiveId(primitive, slug),
    action: 'create',
    writer,
    idempotencyKey: input.idempotencyKey ?? `${primitive}:create:${slug}`,
    payload: sanitized,
    timestamp: now.toISOString()
  });

  return readMarkdownRecord(filePath, primitive);
}

export function getWorkgraphPrimitive(
  vaultPath: string,
  primitive: WritablePrimitive,
  slug: string
): WorkgraphPrimitiveRecord | null {
  const normalizedPrimitive = assertPrimitiveSupported(vaultPath, primitive);
  const filePath = path.join(primitiveDirectory(vaultPath, normalizedPrimitive), `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  return readMarkdownRecord(filePath, normalizedPrimitive);
}

export function updateWorkgraphPrimitive(
  vaultPath: string,
  input: UpdateWorkgraphPrimitiveInput
): WorkgraphPrimitiveRecord {
  const primitive = assertPrimitiveSupported(vaultPath, input.primitive);
  const existing = getWorkgraphPrimitive(vaultPath, primitive, input.slug);
  if (!existing) {
    throw new Error(`Primitive not found: ${primitive}/${input.slug}`);
  }

  const writer = input.writer ?? 'cli';
  const policyGateId = input.policyGateId ?? `${primitive}:update`;
  assertCanonicalWriteAllowed({
    primitive,
    writer,
    policyGate: {
      gateId: policyGateId,
      approved: true
    },
    vaultPath
  });

  const now = new Date();
  const schema = buildPrimitiveSchemaContract(primitive, { vaultPath });
  const normalizedPatch = sanitizePatchFrontmatter(input.patch);
  const nextFrontmatter: Record<string, unknown> = {
    ...applyFrontmatterPatch(existing.frontmatter, normalizedPatch),
    type: primitive,
    primitive,
    id: buildPrimitiveId(primitive, input.slug)
  };
  nextFrontmatter.title = normalizeRequiredTitle(nextFrontmatter.title);
  if (schema.fields.updated) {
    nextFrontmatter.updated = now.toISOString();
  }
  const hydrated = applyPrimitiveDefaults(schema, nextFrontmatter, now);
  const validationErrors = validatePrimitivePayload(schema, hydrated, { mode: 'create' });
  if (validationErrors.length > 0) {
    throw new Error(`Invalid ${primitive} frontmatter: ${buildValidationMessage(validationErrors)}`);
  }

  const sanitized = sanitizePersistedFrontmatter(hydrated);
  fs.writeFileSync(existing.path, matter.stringify(existing.content, sanitized), 'utf-8');
  appendWorkgraphEvent(vaultPath, {
    primitive,
    primitiveId: buildPrimitiveId(primitive, input.slug),
    action: 'update',
    writer,
    idempotencyKey: input.idempotencyKey ?? `${primitive}:update:${input.slug}:${now.toISOString()}`,
    payload: normalizedPatch,
    timestamp: now.toISOString()
  });

  return readMarkdownRecord(existing.path, primitive);
}

export function listWorkgraphPrimitives(
  vaultPath: string,
  primitive: WritablePrimitive,
  options: ListWorkgraphPrimitiveOptions = {}
): WorkgraphPrimitiveRecord[] {
  const normalizedPrimitive = assertPrimitiveSupported(vaultPath, primitive);
  const directory = primitiveDirectory(vaultPath, normalizedPrimitive);
  if (!fs.existsSync(directory)) {
    return [];
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const records = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => readMarkdownRecordOrNull(path.join(directory, entry.name), normalizedPrimitive))
    .filter((record): record is WorkgraphPrimitiveRecord => record !== null);

  const normalizedStatus = options.status?.trim();
  const normalizedOwner = options.owner?.trim();
  const normalizedProject = options.project?.trim();

  const filtered = records.filter((record) => {
    const recordStatus = normalizeComparableString(record.frontmatter.status);
    const recordOwner = normalizeComparableString(record.frontmatter.owner);
    const recordProject = normalizeComparableString(record.frontmatter.project);

    if (normalizedStatus && recordStatus !== normalizedStatus) return false;
    if (normalizedOwner && recordOwner !== normalizedOwner) return false;
    if (normalizedProject && recordProject !== normalizedProject) return false;
    return true;
  });

  return sortRecordsByUpdated(filtered);
}
