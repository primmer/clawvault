import { describe, it } from 'vitest';
import {
  expectUnitCountMapByKeyParity,
  expectUnitCountMapParity
} from './compat-contract-assertion-test-utils.js';

describe('compat contract assertion test utils', () => {
  it('asserts unit count-map parity for array domains', () => {
    expectUnitCountMapParity(
      ['a', 'b', 'a'],
      {
        a: 2,
        b: 1
      },
      'array domain'
    );
  });

  it('asserts keyed unit count-map parity for nested array domains', () => {
    expectUnitCountMapByKeyParity(
      {
        jobs: ['test', 'build', 'test'],
        steps: ['checkout']
      },
      {
        jobs: {
          test: 2,
          build: 1
        },
        steps: {
          checkout: 1
        }
      },
      'nested array domain'
    );
  });
});
