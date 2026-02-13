import { expect } from 'vitest';
import {
  buildUnitCountMap,
  buildUnitCountMapByKey
} from './compat-contract-test-utils.js';

export function expectUnitCountMapParity(values, actualCountMap, label) {
  const expectedCountMap = buildUnitCountMap(values);
  expect(actualCountMap, `${label} count-map parity mismatch`).toEqual(expectedCountMap);
}

export function expectUnitCountMapByKeyParity(valuesByKey, actualCountMapByKey, label) {
  const expectedCountMapByKey = buildUnitCountMapByKey(valuesByKey);
  expect(actualCountMapByKey, `${label} keyed count-map parity mismatch`).toEqual(expectedCountMapByKey);
}

export function expectEachDomainValueOccursExactlyOnce(values, resolveCount, label) {
  expect(Array.isArray(values), `${label} must receive array values`).toBe(true);
  for (const value of values) {
    expect(
      resolveCount(value),
      `${label} expected value to appear exactly once: ${value}`
    ).toBe(1);
  }
}

export function expectUniqueDomainCountMapParity(values, actualCountMap, label) {
  expect(Array.isArray(values), `${label} must receive array values`).toBe(true);
  expect(new Set(values).size, `${label} must contain unique domain values`).toBe(values.length);
  const expectedCountMap = buildUnitCountMap(values);
  expect(actualCountMap, `${label} unique count-map parity mismatch`).toEqual(expectedCountMap);
}

export function expectUniqueDomainCountMapByKeyParity(valuesByKey, actualCountMapByKey, label) {
  expect(valuesByKey && typeof valuesByKey === 'object', `${label} must receive keyed domain values`).toBe(true);
  for (const [domainKey, values] of Object.entries(valuesByKey)) {
    expect(Array.isArray(values), `${label} must provide array domain values for key=${domainKey}`).toBe(true);
    expect(new Set(values).size, `${label} must provide unique domain values for key=${domainKey}`).toBe(values.length);
  }
  const expectedCountMapByKey = buildUnitCountMapByKey(valuesByKey);
  expect(actualCountMapByKey, `${label} unique keyed count-map parity mismatch`).toEqual(expectedCountMapByKey);
}
