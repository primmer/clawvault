import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  REQUIRED_COMPAT_CI_CHECKOUT_STEP_NAME,
  REQUIRED_COMPAT_CI_CHECKOUT_USES,
  REQUIRED_COMPAT_CI_FAILURE_UPLOAD_ARTIFACT_NAME,
  REQUIRED_COMPAT_CI_FAILURE_UPLOAD_CONDITION,
  REQUIRED_COMPAT_CI_FAILURE_UPLOAD_IF_NO_FILES_FOUND,
  REQUIRED_COMPAT_CI_FAILURE_UPLOAD_PATH,
  REQUIRED_COMPAT_CI_FAILURE_UPLOAD_STEP_NAME,
  REQUIRED_COMPAT_CI_INSTALL_COMMAND,
  REQUIRED_COMPAT_CI_INSTALL_STEP_NAME,
  REQUIRED_COMPAT_CI_PRIMARY_RUN_COMMAND,
  REQUIRED_COMPAT_CI_REPORT_DIR_ENV_KEY,
  REQUIRED_COMPAT_CI_REPORT_DIR_ENV_VALUE,
  REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME,
  REQUIRED_COMPAT_CI_SETUP_NODE_CACHE,
  REQUIRED_COMPAT_CI_SETUP_NODE_STEP_NAME,
  REQUIRED_COMPAT_CI_SETUP_NODE_USES,
  REQUIRED_COMPAT_CI_SETUP_NODE_VERSION,
  REQUIRED_COMPAT_CI_STEP_SEQUENCE,
  REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_NAME,
  REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES,
  REQUIRED_COMPAT_CI_UPLOAD_IF_NO_FILES_FOUND,
  REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_PATH_PREFIX,
  REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME
} from './compat-npm-script-contracts.mjs';
import {
  extractEnvField,
  extractRunCommand,
  extractScalarField,
  extractStepBlock,
  extractStepMetadata,
  extractUploadArtifactPaths,
  extractUsesField
} from './compat-ci-workflow-test-utils.js';

function loadCiWorkflowYaml() {
  const workflowPath = path.resolve(process.cwd(), '.github', 'workflows', 'ci.yml');
  return fs.readFileSync(workflowPath, 'utf-8');
}

describe('compat ci workflow contract', () => {
  it('keeps core CI step sequence ordered', () => {
    const workflowYaml = loadCiWorkflowYaml();
    let previousStepStartIndex = -1;
    for (const stepName of REQUIRED_COMPAT_CI_STEP_SEQUENCE) {
      const stepMetadata = extractStepMetadata(workflowYaml, stepName);
      expect(stepMetadata, `missing CI workflow step: ${stepName}`).toBeTruthy();
      const { startIndex } = stepMetadata;
      expect(
        startIndex,
        `step "${stepName}" appears before previous required CI step in sequence`
      ).toBeGreaterThan(previousStepStartIndex);
      previousStepStartIndex = startIndex;
    }
  });

  it('keeps checkout/setup/install steps aligned with canonical CI environment contracts', () => {
    const workflowYaml = loadCiWorkflowYaml();
    const checkoutStepBlock = extractStepBlock(workflowYaml, REQUIRED_COMPAT_CI_CHECKOUT_STEP_NAME);
    const setupNodeStepBlock = extractStepBlock(workflowYaml, REQUIRED_COMPAT_CI_SETUP_NODE_STEP_NAME);
    const installStepBlock = extractStepBlock(workflowYaml, REQUIRED_COMPAT_CI_INSTALL_STEP_NAME);
    expect(checkoutStepBlock, `missing CI workflow step: ${REQUIRED_COMPAT_CI_CHECKOUT_STEP_NAME}`).toBeTruthy();
    expect(setupNodeStepBlock, `missing CI workflow step: ${REQUIRED_COMPAT_CI_SETUP_NODE_STEP_NAME}`).toBeTruthy();
    expect(installStepBlock, `missing CI workflow step: ${REQUIRED_COMPAT_CI_INSTALL_STEP_NAME}`).toBeTruthy();
    expect(extractUsesField(checkoutStepBlock)).toBe(REQUIRED_COMPAT_CI_CHECKOUT_USES);
    expect(extractUsesField(setupNodeStepBlock)).toBe(REQUIRED_COMPAT_CI_SETUP_NODE_USES);
    expect(extractScalarField(setupNodeStepBlock, 'node-version')).toBe(
      REQUIRED_COMPAT_CI_SETUP_NODE_VERSION
    );
    expect(extractScalarField(setupNodeStepBlock, 'cache')).toBe(
      REQUIRED_COMPAT_CI_SETUP_NODE_CACHE
    );
    expect(extractRunCommand(installStepBlock)).toBe(REQUIRED_COMPAT_CI_INSTALL_COMMAND);
  });

  it('runs canonical ci command from primary run step', () => {
    const workflowYaml = loadCiWorkflowYaml();
    const stepBlock = extractStepBlock(workflowYaml, REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME);
    expect(stepBlock, `missing CI workflow step: ${REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME}`).toBeTruthy();
    const runCommand = extractRunCommand(stepBlock);
    const reportDirValue = extractEnvField(stepBlock, REQUIRED_COMPAT_CI_REPORT_DIR_ENV_KEY);
    expect(runCommand).toBe(REQUIRED_COMPAT_CI_PRIMARY_RUN_COMMAND);
    expect(reportDirValue).toBe(REQUIRED_COMPAT_CI_REPORT_DIR_ENV_VALUE);
  });

  it('uploads required compatibility artifact files in canonical order', () => {
    const workflowYaml = loadCiWorkflowYaml();
    const stepBlock = extractStepBlock(workflowYaml, REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME);
    expect(stepBlock, `missing CI workflow step: ${REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME}`).toBeTruthy();
    const artifactName = extractScalarField(stepBlock, 'name');
    const ifNoFilesFoundValue = extractScalarField(stepBlock, 'if-no-files-found');
    const uploadPaths = extractUploadArtifactPaths(stepBlock);
    expect(uploadPaths, `step "${REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME}" must include a multiline path block`).toBeTruthy();
    const expectedPaths = REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES.map(
      (artifactFile) => `${REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_PATH_PREFIX}${artifactFile}`
    );
    expect(artifactName).toBe(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_NAME);
    expect(ifNoFilesFoundValue).toBe(REQUIRED_COMPAT_CI_UPLOAD_IF_NO_FILES_FOUND);
    expect(uploadPaths).toEqual(expectedPaths);
  });

  it('keeps failure artifact upload step aligned with compat report directory contracts', () => {
    const workflowYaml = loadCiWorkflowYaml();
    const stepBlock = extractStepBlock(workflowYaml, REQUIRED_COMPAT_CI_FAILURE_UPLOAD_STEP_NAME);
    expect(stepBlock, `missing CI workflow step: ${REQUIRED_COMPAT_CI_FAILURE_UPLOAD_STEP_NAME}`).toBeTruthy();
    const ifCondition = extractScalarField(stepBlock, 'if');
    const artifactName = extractScalarField(stepBlock, 'name');
    const uploadPath = extractScalarField(stepBlock, 'path');
    const ifNoFilesFoundValue = extractScalarField(stepBlock, 'if-no-files-found');
    expect(ifCondition).toBe(REQUIRED_COMPAT_CI_FAILURE_UPLOAD_CONDITION);
    expect(artifactName).toBe(REQUIRED_COMPAT_CI_FAILURE_UPLOAD_ARTIFACT_NAME);
    expect(uploadPath).toBe(REQUIRED_COMPAT_CI_FAILURE_UPLOAD_PATH);
    expect(ifNoFilesFoundValue).toBe(REQUIRED_COMPAT_CI_FAILURE_UPLOAD_IF_NO_FILES_FOUND);
  });
});
