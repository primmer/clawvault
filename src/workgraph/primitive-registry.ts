import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  MAX_PRIMITIVE_FIELDS,
  MAX_REGISTRY_IDENTIFIER_LIST_ITEMS
} from '../../shared/primitive-registry-limits.js';
import {
  SAFE_REGISTRY_IDENTIFIER_RE,
  isReservedRegistryIdentifier
} from '../../shared/registry-identifier-rules.js';
import { RESERVED_FIELD_NAMES } from '../../shared/reserved-field-names.js';
import {
  LEGACY_REMOVED_TOP_LEVEL_COMMANDS,
  LEGACY_REMOVED_TOP_LEVEL_COMMAND_VARIANTS,
  RESERVED_NON_WORKFLOW_COMMANDS
} from '../../shared/v3-command-surface.js';
import { REMOVED_V3_PRIMITIVE_SET } from './removed-v3-primitives.js';

const PRIMITIVE_NAME_RE = /^[a-z][a-z0-9_-]*$/;
const YAML_FILE_RE = /\.ya?ml$/i;
const DEFAULT_CUSTOM_FIELD_PREFIXES = ['x_'];
const WRITER_POLICY_PROFILE_RE = /^[a-z][a-z0-9_-]*$/;
const DANGEROUS_FIELD_NAMES = new Set(RESERVED_FIELD_NAMES);
const PROTECTED_NO_CLI_PRIMITIVES = new Set(['memory_event']);
const RESERVED_NON_WORKFLOW_COMMAND_SET = new Set(RESERVED_NON_WORKFLOW_COMMANDS);
const LEGACY_REMOVED_TOP_LEVEL_COMMAND_NAME_SET = new Set(LEGACY_REMOVED_TOP_LEVEL_COMMANDS);
const LEGACY_REMOVED_TOP_LEVEL_COMMAND_VARIANT_SET = new Set(LEGACY_REMOVED_TOP_LEVEL_COMMAND_VARIANTS);
const RESERVED_PRIMITIVE_COMMAND_NAME_SET = new Set([
  ...RESERVED_NON_WORKFLOW_COMMAND_SET,
  ...LEGACY_REMOVED_TOP_LEVEL_COMMAND_VARIANT_SET
]);
interface ProtectedPrimitivePolicyLock {
  canonical: boolean;
  derived: boolean;
  storageDir?: string;
  writerPolicyProfile?: string;
  writers?: string[];
}

const PROTECTED_PRIMITIVE_POLICIES: Record<string, ProtectedPrimitivePolicyLock> = {
  memory_event: {
    canonical: true,
    derived: false,
    storageDir: '.clawvault/memory-events',
    writerPolicyProfile: 'observer_ingest',
    writers: ['observer', 'runtime_adapter']
  },
  resume_packet: {
    canonical: false,
    derived: true
  },
  digest: {
    canonical: false,
    derived: true
  }
};
export const PROTECTED_PRIMITIVE_NAMES = Object.freeze(
  Object.keys(PROTECTED_PRIMITIVE_POLICIES)
);
export const PROTECTED_NO_CLI_PRIMITIVE_NAMES = Object.freeze(
  [...PROTECTED_NO_CLI_PRIMITIVES]
);
export const RESERVED_NON_WORKFLOW_COMMAND_NAMES = Object.freeze(
  [...RESERVED_NON_WORKFLOW_COMMAND_SET]
);
export const LEGACY_REMOVED_TOP_LEVEL_COMMAND_NAMES = Object.freeze(
  [...LEGACY_REMOVED_TOP_LEVEL_COMMAND_NAME_SET]
);
export const RESERVED_PRIMITIVE_COMMAND_NAMES = Object.freeze(
  [...RESERVED_PRIMITIVE_COMMAND_NAME_SET]
);

export interface PrimitiveRegistryFieldDefinition {
  type: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  description?: string;
}

export interface PrimitiveRegistryEntry {
  primitive: string;
  canonical: boolean;
  derived: boolean;
  storageDir?: string;
  writerPolicyProfile?: string;
  allowCustomFields: boolean;
  customFieldPrefixes: string[];
  fields: Record<string, PrimitiveRegistryFieldDefinition>;
  writers: string[];
  cli: {
    enabled: boolean;
    create: boolean;
    update: boolean;
    list: boolean;
    show: boolean;
  };
}

export interface PrimitiveRegistry {
  version: number;
  primitives: Record<string, PrimitiveRegistryEntry>;
  sources: string[];
}

export interface PrimitiveRegistryLoadOptions {
  vaultPath?: string;
  builtinRegistryPath?: string;
}

interface MergeAwarePrimitiveRegistryEntry extends PrimitiveRegistryEntry {
  cli: MergeAwareCliSettings;
  __canonicalSpecified?: boolean;
  __derivedSpecified?: boolean;
  __allowCustomFieldsSpecified?: boolean;
  __customFieldPrefixesSpecified?: boolean;
}

interface MergeAwarePrimitiveRegistry {
  version: number;
  primitives: Record<string, MergeAwarePrimitiveRegistryEntry>;
  sources: string[];
}

type PrimitiveCliSettings = PrimitiveRegistryEntry['cli'];

interface MergeAwareCliSettings extends PrimitiveCliSettings {
  __provided: boolean;
  __enabledSpecified: boolean;
  __createSpecified: boolean;
  __updateSpecified: boolean;
  __listSpecified: boolean;
  __showSpecified: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPrimitiveName(value: string, sourcePath: string): string {
  const normalized = value.trim().toLowerCase();
  if (!PRIMITIVE_NAME_RE.test(normalized)) {
    throw new Error(`Invalid primitive name "${value}" in registry ${sourcePath}`);
  }
  if (REMOVED_V3_PRIMITIVE_SET.has(normalized)) {
    throw new Error(`Primitive "${value}" in registry ${sourcePath} is removed in v3 and cannot be registered.`);
  }
  return normalized;
}

function normalizeStorageDir(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return undefined;
  const segments = trimmed.split('/').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return undefined;
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Invalid primitive storageDir: ${value}`);
  }
  return segments.join('/');
}

function assertValidPrimitiveFieldName(fieldName: string, primitiveName: string, sourcePath: string): void {
  if (/\s/.test(fieldName)) {
    throw new Error(
      `Primitive "${primitiveName}" in ${sourcePath} has invalid field name "${fieldName}": field names cannot contain whitespace.`
    );
  }
  if (DANGEROUS_FIELD_NAMES.has(fieldName)) {
    throw new Error(
      `Primitive "${primitiveName}" in ${sourcePath} has invalid field name "${fieldName}": field name "${fieldName}" is reserved.`
    );
  }
}

function normalizeFieldDefinitions(
  value: unknown,
  primitiveName: string,
  sourcePath: string
): Record<string, PrimitiveRegistryFieldDefinition> {
  if (!isRecord(value)) return {};
  const fields: Record<string, PrimitiveRegistryFieldDefinition> = {};
  let parsedFieldCount = 0;
  for (const [fieldName, rawField] of Object.entries(value)) {
    const normalizedFieldName = fieldName.trim();
    if (!normalizedFieldName) {
      throw new Error(
        `Primitive "${primitiveName}" in ${sourcePath} has invalid field name "${fieldName}": field name cannot be empty.`
      );
    }
    parsedFieldCount += 1;
    if (parsedFieldCount > MAX_PRIMITIVE_FIELDS) {
      throw new Error(
        `Primitive "${primitiveName}" in ${sourcePath} has too many field definitions (max ${MAX_PRIMITIVE_FIELDS}).`
      );
    }
    assertValidPrimitiveFieldName(normalizedFieldName, primitiveName, sourcePath);

    if (!isRecord(rawField)) {
      fields[normalizedFieldName] = {
        type: typeof rawField === 'string' && rawField.trim() ? rawField.trim() : 'string',
        default: rawField
      };
      continue;
    }

    const type = typeof rawField.type === 'string' && rawField.type.trim()
      ? rawField.type.trim()
      : 'string';
    const field: PrimitiveRegistryFieldDefinition = { type };
    if (typeof rawField.required === 'boolean') {
      field.required = rawField.required;
    }
    if (Object.prototype.hasOwnProperty.call(rawField, 'default')) {
      field.default = rawField.default;
    }
    if (typeof rawField.description === 'string' && rawField.description.trim()) {
      field.description = rawField.description.trim();
    }
    if (Array.isArray(rawField.enum)) {
      field.enum = rawField.enum;
    }
    fields[normalizedFieldName] = field;
  }
  return fields;
}

function normalizeAllowCustomFields(value: unknown): { value: boolean; specified: boolean } {
  if (typeof value === 'boolean') {
    return {
      value,
      specified: true
    };
  }
  return {
    value: true,
    specified: false
  };
}

function assertSafeRegistryListEntry(
  listName: 'customFieldPrefixes' | 'writers',
  entry: string,
  primitiveName: string,
  sourcePath: string
): void {
  if (/\s/.test(entry)) {
    throw new Error(
      `Primitive "${primitiveName}" in ${sourcePath} has invalid ${listName} entry "${entry}": values cannot contain whitespace.`
    );
  }
  if (isReservedRegistryIdentifier(entry)) {
    throw new Error(
      `Primitive "${primitiveName}" in ${sourcePath} has invalid ${listName} entry "${entry}": value is reserved.`
    );
  }
  if (!SAFE_REGISTRY_IDENTIFIER_RE.test(entry)) {
    throw new Error(
      `Primitive "${primitiveName}" in ${sourcePath} has invalid ${listName} entry "${entry}": values must match ${SAFE_REGISTRY_IDENTIFIER_RE}.`
    );
  }
}

function normalizeRegistryListEntry(
  listName: 'customFieldPrefixes' | 'writers',
  rawEntry: unknown,
  primitiveName: string,
  sourcePath: string
): string {
  if (typeof rawEntry !== 'string') {
    throw new Error(
      `Primitive "${primitiveName}" in ${sourcePath} has invalid ${listName} entry "${String(rawEntry)}": values must be non-empty strings.`
    );
  }
  const entry = rawEntry.trim();
  if (!entry) {
    throw new Error(
      `Primitive "${primitiveName}" in ${sourcePath} has invalid ${listName} entry "${rawEntry}": values must be non-empty strings.`
    );
  }
  return entry;
}

function normalizeCustomPrefixes(
  value: unknown,
  primitiveName: string,
  sourcePath: string
): { value: string[]; specified: boolean } {
  if (!Array.isArray(value)) {
    return {
      value: [...DEFAULT_CUSTOM_FIELD_PREFIXES],
      specified: false
    };
  }
  const prefixes: string[] = [];
  let parsedPrefixCount = 0;
  for (const rawEntry of value) {
    const entry = normalizeRegistryListEntry('customFieldPrefixes', rawEntry, primitiveName, sourcePath);
    parsedPrefixCount += 1;
    if (parsedPrefixCount > MAX_REGISTRY_IDENTIFIER_LIST_ITEMS) {
      throw new Error(
        `Primitive "${primitiveName}" in ${sourcePath} has too many customFieldPrefixes entries (max ${MAX_REGISTRY_IDENTIFIER_LIST_ITEMS}).`
      );
    }
    assertSafeRegistryListEntry('customFieldPrefixes', entry, primitiveName, sourcePath);
    prefixes.push(entry);
  }
  return {
    value: prefixes.length > 0 ? [...new Set(prefixes)] : [...DEFAULT_CUSTOM_FIELD_PREFIXES],
    specified: true
  };
}

function normalizeWriterList(value: unknown, primitiveName: string, sourcePath: string): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  let parsedWriterCount = 0;
  for (const rawEntry of value) {
    const entry = normalizeRegistryListEntry('writers', rawEntry, primitiveName, sourcePath);
    parsedWriterCount += 1;
    if (parsedWriterCount > MAX_REGISTRY_IDENTIFIER_LIST_ITEMS) {
      throw new Error(
        `Primitive "${primitiveName}" in ${sourcePath} has too many writers entries (max ${MAX_REGISTRY_IDENTIFIER_LIST_ITEMS}).`
      );
    }
    assertSafeRegistryListEntry('writers', entry, primitiveName, sourcePath);
    normalized.push(entry);
  }
  return [...new Set(normalized)];
}

function normalizeWriterPolicyProfile(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!WRITER_POLICY_PROFILE_RE.test(normalized)) {
    throw new Error(`Invalid writerPolicyProfile value: ${value}`);
  }
  return normalized;
}

function normalizeCliSettings(value: unknown): MergeAwareCliSettings {
  if (!isRecord(value)) {
    return {
      enabled: true,
      create: true,
      update: true,
      list: true,
      show: true,
      __provided: false,
      __enabledSpecified: false,
      __createSpecified: false,
      __updateSpecified: false,
      __listSpecified: false,
      __showSpecified: false
    };
  }

  const enabledRaw = value.enabled;
  const createRaw = value.create;
  const updateRaw = value.update;
  const listRaw = value.list;
  const showRaw = value.show;

  const enabledSpecified = typeof enabledRaw === 'boolean';
  const createSpecified = typeof createRaw === 'boolean';
  const updateSpecified = typeof updateRaw === 'boolean';
  const listSpecified = typeof listRaw === 'boolean';
  const showSpecified = typeof showRaw === 'boolean';

  const enabled = enabledSpecified ? enabledRaw : true;
  const create = createSpecified ? createRaw : true;
  const update = updateSpecified ? updateRaw : true;
  const list = listSpecified ? listRaw : true;
  const show = showSpecified ? showRaw : true;
  if (!enabled) {
    return {
      enabled: false,
      create: false,
      update: false,
      list: false,
      show: false,
      __provided: true,
      __enabledSpecified: enabledSpecified,
      __createSpecified: createSpecified,
      __updateSpecified: updateSpecified,
      __listSpecified: listSpecified,
      __showSpecified: showSpecified
    };
  }
  return {
    enabled,
    create,
    update,
    list,
    show,
    __provided: true,
    __enabledSpecified: enabledSpecified,
    __createSpecified: createSpecified,
    __updateSpecified: updateSpecified,
    __listSpecified: listSpecified,
    __showSpecified: showSpecified
  };
}

function hasExposedCliActions(cli: PrimitiveCliSettings): boolean {
  return !!(cli.create || cli.update || cli.list || cli.show);
}

function normalizePrimitiveEntry(
  primitiveName: string,
  rawEntry: unknown,
  sourcePath: string
): MergeAwarePrimitiveRegistryEntry {
  if (!isRecord(rawEntry)) {
    throw new Error(`Primitive "${primitiveName}" in ${sourcePath} must be an object.`);
  }

  const canonicalValue = rawEntry.canonical;
  const derivedValue = rawEntry.derived;
  const canonicalSpecified = typeof canonicalValue === 'boolean';
  const derivedSpecified = typeof derivedValue === 'boolean';
  const canonical = canonicalSpecified ? canonicalValue : true;
  const derived = derivedSpecified ? derivedValue : !canonical;
  if (canonical && derived) {
    throw new Error(`Primitive "${primitiveName}" in ${sourcePath} cannot be both canonical and derived.`);
  }
  if (!canonical && !derived) {
    throw new Error(`Primitive "${primitiveName}" in ${sourcePath} must be canonical or derived.`);
  }
  const cli = normalizeCliSettings(rawEntry.cli);
  const allowCustomFields = normalizeAllowCustomFields(rawEntry.allowCustomFields);
  const customFieldPrefixes = normalizeCustomPrefixes(rawEntry.customFieldPrefixes, primitiveName, sourcePath);
  const entry: MergeAwarePrimitiveRegistryEntry = {
    primitive: primitiveName,
    canonical,
    derived,
    storageDir: normalizeStorageDir(rawEntry.storageDir),
    writerPolicyProfile: normalizeWriterPolicyProfile(rawEntry.writerPolicyProfile),
    allowCustomFields: allowCustomFields.value,
    customFieldPrefixes: customFieldPrefixes.value,
    fields: normalizeFieldDefinitions(rawEntry.fields, primitiveName, sourcePath),
    writers: normalizeWriterList(rawEntry.writers, primitiveName, sourcePath),
    cli,
    __canonicalSpecified: canonicalSpecified,
    __derivedSpecified: derivedSpecified,
    __allowCustomFieldsSpecified: allowCustomFields.specified,
    __customFieldPrefixesSpecified: customFieldPrefixes.specified
  };
  return entry;
}

function hasSameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  if (leftSet.size !== right.length) return false;
  return right.every((entry) => leftSet.has(entry));
}

function assertNoCliProtectedExposure(registry: MergeAwarePrimitiveRegistry): void {
  for (const primitiveName of PROTECTED_NO_CLI_PRIMITIVES) {
    const entry = registry.primitives[primitiveName];
    if (entry?.cli.enabled) {
      throw new Error(`Primitive "${primitiveName}" in resolved registry cannot enable CLI exposure.`);
    }
  }
}

function assertProtectedPrimitivePolicies(registry: MergeAwarePrimitiveRegistry): void {
  for (const [primitiveName, lock] of Object.entries(PROTECTED_PRIMITIVE_POLICIES)) {
    const entry = registry.primitives[primitiveName];
    if (!entry) continue;
    if (entry.canonical !== lock.canonical || entry.derived !== lock.derived) {
      throw new Error(
        `Primitive "${primitiveName}" in resolved registry must remain canonical=${lock.canonical} and derived=${lock.derived}.`
      );
    }
    if (typeof lock.storageDir === 'string' && entry.storageDir !== lock.storageDir) {
      throw new Error(`Primitive "${primitiveName}" in resolved registry must keep storageDir "${lock.storageDir}".`);
    }
    if (
      typeof lock.writerPolicyProfile === 'string'
      && entry.writerPolicyProfile !== lock.writerPolicyProfile
    ) {
      throw new Error(
        `Primitive "${primitiveName}" in resolved registry must keep writerPolicyProfile "${lock.writerPolicyProfile}".`
      );
    }
    if (Array.isArray(lock.writers) && !hasSameMembers(entry.writers, lock.writers)) {
      throw new Error(
        `Primitive "${primitiveName}" in resolved registry must keep writers [${lock.writers.join(', ')}].`
      );
    }
  }
}

function assertNoReservedCommandNameCollisions(registry: MergeAwarePrimitiveRegistry): void {
  for (const entry of Object.values(registry.primitives)) {
    if (!entry.canonical || !entry.cli.enabled) continue;
    if (!hasExposedCliActions(entry.cli)) continue;
    if (!RESERVED_PRIMITIVE_COMMAND_NAME_SET.has(entry.primitive)) continue;
    const reason = LEGACY_REMOVED_TOP_LEVEL_COMMAND_VARIANT_SET.has(entry.primitive)
      ? 'the name is reserved as a removed legacy v3 command'
      : 'the name is reserved by the v3 command surface';
    throw new Error(
      `Primitive "${entry.primitive}" in resolved registry cannot expose top-level CLI command because ${reason}.`
    );
  }
}

function validateResolvedRegistry(registry: MergeAwarePrimitiveRegistry): void {
  assertNoCliProtectedExposure(registry);
  assertProtectedPrimitivePolicies(registry);
  assertNoReservedCommandNameCollisions(registry);
}

function parseRegistryDocument(raw: string, sourcePath: string): MergeAwarePrimitiveRegistry {
  const parsed = parseYaml(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Primitive registry ${sourcePath} must be a YAML object.`);
  }

  const primitivesRaw = parsed.primitives;
  if (!isRecord(primitivesRaw)) {
    throw new Error(`Primitive registry ${sourcePath} is missing "primitives" map.`);
  }

  const registry: MergeAwarePrimitiveRegistry = {
    version: typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : 1,
    primitives: {},
    sources: [sourcePath]
  };

  for (const [rawName, rawEntry] of Object.entries(primitivesRaw)) {
    const primitiveName = assertPrimitiveName(rawName, sourcePath);
    registry.primitives[primitiveName] = normalizePrimitiveEntry(primitiveName, rawEntry, sourcePath);
  }

  return registry;
}

function mergeCliSettings(base: MergeAwareCliSettings | undefined, incoming: MergeAwareCliSettings): MergeAwareCliSettings {
  if (!base) {
    return { ...incoming };
  }
  if (!incoming.__provided) {
    return { ...base };
  }

  if (incoming.__enabledSpecified && incoming.enabled === false) {
    return {
      enabled: false,
      create: false,
      update: false,
      list: false,
      show: false,
      __provided: true,
      __enabledSpecified: true,
      __createSpecified: incoming.__createSpecified,
      __updateSpecified: incoming.__updateSpecified,
      __listSpecified: incoming.__listSpecified,
      __showSpecified: incoming.__showSpecified
    };
  }

  const enabled = incoming.__enabledSpecified ? incoming.enabled : base.enabled;
  const create = incoming.__createSpecified ? incoming.create : base.create;
  const update = incoming.__updateSpecified ? incoming.update : base.update;
  const list = incoming.__listSpecified ? incoming.list : base.list;
  const show = incoming.__showSpecified ? incoming.show : base.show;

  if (!enabled) {
    return {
      enabled: false,
      create: false,
      update: false,
      list: false,
      show: false,
      __provided: true,
      __enabledSpecified: incoming.__enabledSpecified,
      __createSpecified: incoming.__createSpecified,
      __updateSpecified: incoming.__updateSpecified,
      __listSpecified: incoming.__listSpecified,
      __showSpecified: incoming.__showSpecified
    };
  }

  return {
    enabled,
    create,
    update,
    list,
    show,
    __provided: true,
    __enabledSpecified: incoming.__enabledSpecified,
    __createSpecified: incoming.__createSpecified,
    __updateSpecified: incoming.__updateSpecified,
    __listSpecified: incoming.__listSpecified,
    __showSpecified: incoming.__showSpecified
  };
}

function mergePrimitiveEntry(
  base: MergeAwarePrimitiveRegistryEntry | undefined,
  incoming: MergeAwarePrimitiveRegistryEntry
): MergeAwarePrimitiveRegistryEntry {
  const canonicalSpecified = incoming.__canonicalSpecified === true || incoming.__derivedSpecified === true;
  if (!base) {
    return {
      primitive: incoming.primitive,
      canonical: incoming.canonical,
      derived: incoming.derived,
      storageDir: incoming.storageDir,
      writerPolicyProfile: incoming.writerPolicyProfile,
      allowCustomFields: incoming.allowCustomFields,
      fields: { ...incoming.fields },
      customFieldPrefixes: [...incoming.customFieldPrefixes],
      writers: [...incoming.writers],
      cli: { ...incoming.cli },
      __canonicalSpecified: incoming.__canonicalSpecified,
      __derivedSpecified: incoming.__derivedSpecified,
      __allowCustomFieldsSpecified: incoming.__allowCustomFieldsSpecified,
      __customFieldPrefixesSpecified: incoming.__customFieldPrefixesSpecified
    };
  }

  return {
    primitive: incoming.primitive,
    canonical: canonicalSpecified ? incoming.canonical : base.canonical,
    derived: canonicalSpecified ? incoming.derived : base.derived,
    storageDir: incoming.storageDir ?? base.storageDir,
    writerPolicyProfile: incoming.writerPolicyProfile ?? base.writerPolicyProfile,
    allowCustomFields: incoming.__allowCustomFieldsSpecified ? incoming.allowCustomFields : base.allowCustomFields,
    customFieldPrefixes: incoming.__customFieldPrefixesSpecified
      ? [...incoming.customFieldPrefixes]
      : [...base.customFieldPrefixes],
    writers: incoming.writers.length > 0 ? [...incoming.writers] : [...base.writers],
    cli: mergeCliSettings(base.cli, incoming.cli),
    fields: {
      ...base.fields,
      ...incoming.fields
    },
    __canonicalSpecified: incoming.__canonicalSpecified,
    __derivedSpecified: incoming.__derivedSpecified,
    __allowCustomFieldsSpecified: incoming.__allowCustomFieldsSpecified,
    __customFieldPrefixesSpecified: incoming.__customFieldPrefixesSpecified
  };
}

function mergeRegistries(base: MergeAwarePrimitiveRegistry, incoming: MergeAwarePrimitiveRegistry): MergeAwarePrimitiveRegistry {
  const merged: MergeAwarePrimitiveRegistry = {
    version: Math.max(base.version, incoming.version),
    primitives: { ...base.primitives },
    sources: [...base.sources, ...incoming.sources]
  };

  for (const [name, entry] of Object.entries(incoming.primitives)) {
    merged.primitives[name] = mergePrimitiveEntry(merged.primitives[name], entry);
  }

  return merged;
}

function resolveBuiltinRegistryPath(override?: string): string {
  if (override) {
    return path.resolve(override);
  }
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, '../templates/primitive-registry.yaml'),
    path.resolve(moduleDir, '../../templates/primitive-registry.yaml'),
    path.resolve(moduleDir, '../../../templates/primitive-registry.yaml')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error('Unable to resolve builtin primitive registry path.');
}

function listVaultRegistryFiles(vaultPath: string): string[] {
  const resolvedVaultPath = path.resolve(vaultPath);
  const candidateDirs = [
    path.join(resolvedVaultPath, 'primitives'),
    path.join(resolvedVaultPath, '.clawvault', 'primitives')
  ];
  const files: string[] = [];

  for (const directory of candidateDirs) {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      continue;
    }
    const directoryFiles = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && YAML_FILE_RE.test(entry.name))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
    for (const filePath of directoryFiles) {
      files.push(filePath);
    }
  }

  return files;
}

function loadRegistryFromFile(filePath: string): MergeAwarePrimitiveRegistry {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return parseRegistryDocument(raw, filePath);
}

function toPublicPrimitiveEntry(entry: MergeAwarePrimitiveRegistryEntry): PrimitiveRegistryEntry {
  return {
    primitive: entry.primitive,
    canonical: entry.canonical,
    derived: entry.derived,
    storageDir: entry.storageDir,
    writerPolicyProfile: entry.writerPolicyProfile,
    allowCustomFields: entry.allowCustomFields,
    customFieldPrefixes: [...entry.customFieldPrefixes],
    fields: { ...entry.fields },
    writers: [...entry.writers],
    cli: {
      enabled: entry.cli.enabled,
      create: entry.cli.create,
      update: entry.cli.update,
      list: entry.cli.list,
      show: entry.cli.show
    }
  };
}

function toPublicRegistry(registry: MergeAwarePrimitiveRegistry): PrimitiveRegistry {
  const primitives: Record<string, PrimitiveRegistryEntry> = {};
  for (const [name, entry] of Object.entries(registry.primitives)) {
    primitives[name] = toPublicPrimitiveEntry(entry);
  }
  return {
    version: registry.version,
    primitives,
    sources: [...registry.sources]
  };
}

export function loadPrimitiveRegistry(options: PrimitiveRegistryLoadOptions = {}): PrimitiveRegistry {
  const builtinPath = resolveBuiltinRegistryPath(options.builtinRegistryPath);
  let registry = loadRegistryFromFile(builtinPath);

  if (options.vaultPath) {
    for (const overridePath of listVaultRegistryFiles(options.vaultPath)) {
      const overrideRegistry = loadRegistryFromFile(overridePath);
      registry = mergeRegistries(registry, overrideRegistry);
    }
  }

  validateResolvedRegistry(registry);
  return toPublicRegistry(registry);
}

export function getPrimitiveRegistryEntry(
  primitive: string,
  options: PrimitiveRegistryLoadOptions = {}
): PrimitiveRegistryEntry | null {
  const normalizedPrimitive = primitive.trim().toLowerCase();
  const registry = loadPrimitiveRegistry(options);
  return registry.primitives[normalizedPrimitive] ?? null;
}
