import { RESERVED_FIELD_NAMES } from './reserved-field-names.js';

export const SAFE_REGISTRY_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RESERVED_IDENTIFIER_SET = new Set(RESERVED_FIELD_NAMES.map((entry) => entry.toLowerCase()));

export function isReservedRegistryIdentifier(value) {
  return RESERVED_IDENTIFIER_SET.has(String(value).toLowerCase());
}
