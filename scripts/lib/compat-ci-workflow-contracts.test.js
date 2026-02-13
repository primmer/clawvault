import { describe, expect, it } from 'vitest';
import {
  REQUIRED_COMPAT_CI_PRIMARY_RUN_COMMAND,
  REQUIRED_COMPAT_CI_REPORT_DIR_ENV_KEY,
  REQUIRED_COMPAT_CI_REPORT_DIR_ENV_VALUE,
  REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME,
  REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_NAME,
  REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES,
  REQUIRED_COMPAT_CI_UPLOAD_IF_NO_FILES_FOUND,
  REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_PATH_PREFIX,
  REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME
} from './compat-npm-script-contracts.mjs';

describe('compat ci workflow contracts constants', () => {
  it('keeps required ci workflow string contracts non-empty', () => {
    expect(typeof REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME).toBe('string');
    expect(REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_PRIMARY_RUN_COMMAND).toBe('string');
    expect(REQUIRED_COMPAT_CI_PRIMARY_RUN_COMMAND.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME).toBe('string');
    expect(REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_NAME).toBe('string');
    expect(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_NAME.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_UPLOAD_IF_NO_FILES_FOUND).toBe('string');
    expect(REQUIRED_COMPAT_CI_UPLOAD_IF_NO_FILES_FOUND.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_PATH_PREFIX).toBe('string');
    expect(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_PATH_PREFIX.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_REPORT_DIR_ENV_KEY).toBe('string');
    expect(REQUIRED_COMPAT_CI_REPORT_DIR_ENV_KEY.length).toBeGreaterThan(0);
    expect(typeof REQUIRED_COMPAT_CI_REPORT_DIR_ENV_VALUE).toBe('string');
    expect(REQUIRED_COMPAT_CI_REPORT_DIR_ENV_VALUE.length).toBeGreaterThan(0);
  });

  it('keeps required upload artifact file domain unique and non-empty', () => {
    expect(Array.isArray(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES)).toBe(true);
    expect(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES.length).toBeGreaterThan(0);
    expect(
      REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES.every((artifactFile) => typeof artifactFile === 'string' && artifactFile.length > 0)
    ).toBe(true);
    expect(new Set(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES).size).toBe(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES.length);
    expect(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES).toContain('artifact-bundle-validator-result.json');
    expect(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES).toContain('summary.json');
  });
});
