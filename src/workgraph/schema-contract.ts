import { getPrimitiveRegistryEntry, type PrimitiveRegistryFieldDefinition } from './primitive-registry.js';

const DEFAULT_CUSTOM_FIELD_PREFIXES = ['x_'];
const TEMPLATE_PLACEHOLDER_DATE = '{{date}}';
const TEMPLATE_PLACEHOLDER_DATETIME = '{{datetime}}';
const SYSTEM_FIELDS: Record<string, PrimitiveFieldContract> = {
  title: {
    type: 'string',
    description: 'Document display title.'
  },
  type: {
    type: 'string',
    description: 'Primitive discriminator.'
  },
  primitive: {
    type: 'string',
    description: 'Internal primitive identity.'
  },
  id: {
    type: 'string',
    description: 'Stable primitive identifier.'
  }
};

type ContractFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'string[]'
  | 'array'
  | 'object';

export interface PrimitiveFieldContract {
  type: ContractFieldType;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  description?: string;
}

export interface PrimitiveSchemaContract {
  primitive: string;
  fields: Record<string, PrimitiveFieldContract>;
  allowCustomFields: boolean;
  customFieldPrefixes: string[];
}

export interface PrimitiveValidationError {
  field: string;
  code: 'required' | 'unknown_field' | 'invalid_type' | 'enum';
  message: string;
}

interface PrimitiveSchemaContractOptions {
  vaultPath?: string;
  /**
   * @deprecated Custom-field policy now comes exclusively from registry YAML.
   */
  allowCustomFields?: boolean;
  /**
   * @deprecated Custom-field policy now comes exclusively from registry YAML.
   */
  customFieldPrefixes?: string[];
}

function inferContractType(type: string): ContractFieldType {
  const normalized = type.trim().toLowerCase();
  if (normalized === 'string' || normalized === 'number' || normalized === 'boolean') {
    return normalized;
  }
  if (normalized === 'date' || normalized === 'datetime') {
    return normalized;
  }
  if (normalized === 'string[]') {
    return 'string[]';
  }
  if (normalized.includes('[]') || normalized === 'array') {
    return 'array';
  }
  if (normalized === 'object') {
    return 'object';
  }
  return 'string';
}

function mapRegistryFields(fields: Record<string, PrimitiveRegistryFieldDefinition>): Record<string, PrimitiveFieldContract> {
  const mapped: Record<string, PrimitiveFieldContract> = {};
  for (const [fieldName, field] of Object.entries(fields)) {
    mapped[fieldName] = {
      type: inferContractType(field.type),
      required: field.required,
      default: field.default,
      enum: field.enum,
      description: field.description
    };
  }
  return mapped;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isIsoDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function validateFieldType(type: ContractFieldType, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'date') return typeof value === 'string' && isIsoDate(value);
  if (type === 'datetime') return typeof value === 'string' && isIsoDateTime(value);
  if (type === 'string[]') {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return true;
}

function normalizeDefaultValue(value: unknown, now: Date): unknown {
  if (typeof value === 'string') {
    if (value === TEMPLATE_PLACEHOLDER_DATE) return now.toISOString().slice(0, 10);
    if (value === TEMPLATE_PLACEHOLDER_DATETIME) return now.toISOString();
  }
  return value;
}

function allowsCustomField(field: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => field.startsWith(prefix));
}

function assertNoCallSiteCustomFieldOverrides(
  primitive: string,
  options: PrimitiveSchemaContractOptions
): void {
  const overrideKeys: string[] = [];
  if (Object.prototype.hasOwnProperty.call(options, 'allowCustomFields')) {
    overrideKeys.push('allowCustomFields');
  }
  if (Object.prototype.hasOwnProperty.call(options, 'customFieldPrefixes')) {
    overrideKeys.push('customFieldPrefixes');
  }
  if (overrideKeys.length === 0) return;
  throw new Error(
    `buildPrimitiveSchemaContract("${primitive}") no longer accepts call-site custom-field policy overrides (${overrideKeys.join(', ')}). ` +
    'Define custom-field policy in primitive registry YAML instead.'
  );
}

export function buildPrimitiveSchemaContract(
  primitive: string,
  options: PrimitiveSchemaContractOptions = {}
): PrimitiveSchemaContract {
  assertNoCallSiteCustomFieldOverrides(primitive, options);
  const registryEntry = getPrimitiveRegistryEntry(primitive, {
    vaultPath: options.vaultPath
  });
  const fields = {
    ...SYSTEM_FIELDS,
    ...(registryEntry ? mapRegistryFields(registryEntry.fields) : {})
  };
  return {
    primitive,
    fields,
    allowCustomFields: registryEntry?.allowCustomFields ?? true,
    customFieldPrefixes: registryEntry?.customFieldPrefixes ?? DEFAULT_CUSTOM_FIELD_PREFIXES
  };
}

export function applyPrimitiveDefaults(
  schema: PrimitiveSchemaContract,
  payload: Record<string, unknown>,
  now: Date = new Date()
): Record<string, unknown> {
  const next = { ...payload };
  for (const [fieldName, field] of Object.entries(schema.fields)) {
    if (next[fieldName] !== undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(field, 'default')) continue;
    next[fieldName] = normalizeDefaultValue(field.default, now);
  }
  return next;
}

export function validatePrimitivePayload(
  schema: PrimitiveSchemaContract,
  payload: Record<string, unknown>,
  options: { mode?: 'create' | 'update' } = {}
): PrimitiveValidationError[] {
  const mode = options.mode ?? 'create';
  const errors: PrimitiveValidationError[] = [];

  for (const key of Object.keys(payload)) {
    if (schema.fields[key]) continue;
    if (schema.allowCustomFields && allowsCustomField(key, schema.customFieldPrefixes)) continue;
    errors.push({
      field: key,
      code: 'unknown_field',
      message: `Unknown field "${key}" for primitive "${schema.primitive}".`
    });
  }

  for (const [fieldName, field] of Object.entries(schema.fields)) {
    const value = payload[fieldName];
    if (mode === 'create' && field.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: fieldName,
        code: 'required',
        message: `Required field "${fieldName}" is missing.`
      });
      continue;
    }

    if (!validateFieldType(field.type, value)) {
      errors.push({
        field: fieldName,
        code: 'invalid_type',
        message: `Field "${fieldName}" must be ${field.type}.`
      });
      continue;
    }

    if (value !== undefined && value !== null && field.enum && field.enum.length > 0) {
      if (!field.enum.includes(value)) {
        errors.push({
          field: fieldName,
          code: 'enum',
          message: `Field "${fieldName}" must be one of: ${field.enum.join(', ')}.`
        });
      }
    }
  }

  return errors;
}
