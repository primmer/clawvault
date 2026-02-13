import { describe, expect, it } from 'vitest';
import {
  REQUIRED_COMPAT_ARTIFACT_PRODUCER_CONSUMER_CONTRACTS,
  REQUIRED_COMPAT_CI_PRIMARY_RUN_COMMAND,
  REQUIRED_COMPAT_CI_REPORT_DIR_ENV_KEY,
  REQUIRED_COMPAT_CI_REPORT_DIR_ENV_VALUE,
  REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME,
  REQUIRED_COMPAT_CI_REACHABLE_SCRIPT_NAMES,
  REQUIRED_COMPAT_CI_SEQUENCE,
  REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_NAME,
  REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES,
  REQUIRED_COMPAT_CI_UPLOAD_IF_NO_FILES_FOUND,
  REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_PATH_PREFIX,
  REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME,
  REQUIRED_COMPAT_ARTIFACT_CLI_DRIFT_PATHS,
  REQUIRED_COMPAT_ARTIFACT_STACK_SEQUENCE,
  REQUIRED_COMPAT_NPM_SCRIPT_NAMES,
  REQUIRED_COMPAT_REPORT_STACK_SEQUENCE,
  REQUIRED_COMPAT_SCRIPT_STACK_CONTRACT_TEST_PATHS,
  REQUIRED_COMPAT_SUMMARY_STACK_SEQUENCE,
  REQUIRED_COMPAT_SCRIPT_REFERENCE_SOURCES,
  REQUIRED_COMPAT_VALIDATOR_STACK_SEQUENCE
} from './compat-npm-script-contracts.mjs';

function expectNonEmptyUniqueStringArray(values, label) {
  expect(Array.isArray(values), `${label} must be an array`).toBe(true);
  expect(values.length, `${label} must not be empty`).toBeGreaterThan(0);
  expect(values.every((value) => typeof value === 'string' && value.length > 0), `${label} must contain non-empty strings`).toBe(true);
  expect(new Set(values).size, `${label} must be unique`).toBe(values.length);
}

describe('compat npm script contracts constants', () => {
  it('keeps required script names unique and non-empty', () => {
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_NPM_SCRIPT_NAMES, 'REQUIRED_COMPAT_NPM_SCRIPT_NAMES');
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_CI_REACHABLE_SCRIPT_NAMES, 'REQUIRED_COMPAT_CI_REACHABLE_SCRIPT_NAMES');
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_SCRIPT_REFERENCE_SOURCES, 'REQUIRED_COMPAT_SCRIPT_REFERENCE_SOURCES');
    expect(REQUIRED_COMPAT_CI_REACHABLE_SCRIPT_NAMES).toEqual(REQUIRED_COMPAT_NPM_SCRIPT_NAMES);
    expect(REQUIRED_COMPAT_SCRIPT_REFERENCE_SOURCES.every((name) => REQUIRED_COMPAT_NPM_SCRIPT_NAMES.includes(name))).toBe(true);
  });

  it('keeps required stack sequences and drift paths unique and non-empty', () => {
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_ARTIFACT_CLI_DRIFT_PATHS, 'REQUIRED_COMPAT_ARTIFACT_CLI_DRIFT_PATHS');
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_SCRIPT_STACK_CONTRACT_TEST_PATHS, 'REQUIRED_COMPAT_SCRIPT_STACK_CONTRACT_TEST_PATHS');
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES, 'REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES');
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_ARTIFACT_STACK_SEQUENCE, 'REQUIRED_COMPAT_ARTIFACT_STACK_SEQUENCE');
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_REPORT_STACK_SEQUENCE, 'REQUIRED_COMPAT_REPORT_STACK_SEQUENCE');
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_VALIDATOR_STACK_SEQUENCE, 'REQUIRED_COMPAT_VALIDATOR_STACK_SEQUENCE');
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_SUMMARY_STACK_SEQUENCE, 'REQUIRED_COMPAT_SUMMARY_STACK_SEQUENCE');
    expectNonEmptyUniqueStringArray(REQUIRED_COMPAT_CI_SEQUENCE, 'REQUIRED_COMPAT_CI_SEQUENCE');
    expect(typeof REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_PATH_PREFIX).toBe('string');
    expect(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_PATH_PREFIX.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME).toBe('string');
    expect(REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_NAME).toBe('string');
    expect(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_NAME.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_UPLOAD_IF_NO_FILES_FOUND).toBe('string');
    expect(REQUIRED_COMPAT_CI_UPLOAD_IF_NO_FILES_FOUND.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME).toBe('string');
    expect(REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_PRIMARY_RUN_COMMAND).toBe('string');
    expect(REQUIRED_COMPAT_CI_PRIMARY_RUN_COMMAND.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_REPORT_DIR_ENV_KEY).toBe('string');
    expect(REQUIRED_COMPAT_CI_REPORT_DIR_ENV_KEY.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_REPORT_DIR_ENV_VALUE).toBe('string');
    expect(REQUIRED_COMPAT_CI_REPORT_DIR_ENV_VALUE.length).toBeGreaterThan(0);
    expect(Array.isArray(REQUIRED_COMPAT_ARTIFACT_PRODUCER_CONSUMER_CONTRACTS)).toBe(true);
    expect(REQUIRED_COMPAT_ARTIFACT_PRODUCER_CONSUMER_CONTRACTS.length).toBeGreaterThan(0);
    for (const contract of REQUIRED_COMPAT_ARTIFACT_PRODUCER_CONSUMER_CONTRACTS) {
      expect(typeof contract.scriptName).toBe('string');
      expect(contract.scriptName.length).toBeGreaterThan(0);
      expect(typeof contract.artifactFile).toBe('string');
      expect(contract.artifactFile.length).toBeGreaterThan(0);
      expect(typeof contract.producerSegment).toBe('string');
      expect(contract.producerSegment.length).toBeGreaterThan(0);
      expect(typeof contract.consumerSegment).toBe('string');
      expect(contract.consumerSegment.length).toBeGreaterThan(0);
      expect(contract.producerSegment).not.toBe(contract.consumerSegment);
    }
  });
});
