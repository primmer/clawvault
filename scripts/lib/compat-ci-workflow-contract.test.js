import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadCiWorkflowYaml() {
  const workflowPath = path.resolve(process.cwd(), '.github', 'workflows', 'ci.yml');
  return fs.readFileSync(workflowPath, 'utf-8');
}

function extractStepBlock(workflowYaml, stepName) {
  const stepHeaderPattern = new RegExp(`\\n\\s+- name:\\s+${escapeRegex(stepName)}\\s*\\n`);
  const headerMatch = stepHeaderPattern.exec(workflowYaml);
  expect(headerMatch, `missing CI workflow step: ${stepName}`).toBeTruthy();
  const startIndex = headerMatch.index;
  const nextStepIndex = workflowYaml.indexOf('\n      - name:', startIndex + headerMatch[0].length);
  if (nextStepIndex < 0) {
    return workflowYaml.slice(startIndex);
  }
  return workflowYaml.slice(startIndex, nextStepIndex);
}

function extractRunCommand(stepBlock, stepName) {
  const runLine = stepBlock
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('run:'));
  expect(runLine, `step "${stepName}" must include a run command`).toBeTruthy();
  return runLine.replace(/^run:\s*/, '').trim();
}

function extractScalarField(stepBlock, fieldName, stepName) {
  const line = stepBlock
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${fieldName}:`));
  expect(line, `step "${stepName}" must include ${fieldName}`).toBeTruthy();
  return line.replace(new RegExp(`^${escapeRegex(fieldName)}:\\s*`), '').trim();
}

function extractEnvField(stepBlock, envKey, stepName) {
  const line = stepBlock
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${envKey}:`));
  expect(line, `step "${stepName}" must define env ${envKey}`).toBeTruthy();
  return line.replace(new RegExp(`^${escapeRegex(envKey)}:\\s*`), '').trim();
}

function extractUploadArtifactPaths(stepBlock, stepName) {
  const lines = stepBlock.split('\n').map((line) => line.trim());
  const pathLineIndex = lines.findIndex((line) => line === 'path:' || line === 'path: |');
  expect(pathLineIndex, `step "${stepName}" must include a multiline path block`).toBeGreaterThanOrEqual(0);
  const pathLines = [];
  for (let index = pathLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    if (line.startsWith('if-no-files-found:')) {
      break;
    }
    if (line.includes(':') && !line.startsWith('${{')) {
      break;
    }
    pathLines.push(line);
  }
  return pathLines;
}

describe('compat ci workflow contract', () => {
  it('runs canonical ci command from primary run step', () => {
    const workflowYaml = loadCiWorkflowYaml();
    const stepBlock = extractStepBlock(workflowYaml, REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME);
    const runCommand = extractRunCommand(stepBlock, REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME);
    const reportDirValue = extractEnvField(
      stepBlock,
      REQUIRED_COMPAT_CI_REPORT_DIR_ENV_KEY,
      REQUIRED_COMPAT_CI_PRIMARY_RUN_STEP_NAME
    );
    expect(runCommand).toBe(REQUIRED_COMPAT_CI_PRIMARY_RUN_COMMAND);
    expect(reportDirValue).toBe(REQUIRED_COMPAT_CI_REPORT_DIR_ENV_VALUE);
  });

  it('uploads required compatibility artifact files in canonical order', () => {
    const workflowYaml = loadCiWorkflowYaml();
    const stepBlock = extractStepBlock(workflowYaml, REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME);
    const artifactName = extractScalarField(stepBlock, 'name', REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME);
    const ifNoFilesFoundValue = extractScalarField(stepBlock, 'if-no-files-found', REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME);
    const uploadPaths = extractUploadArtifactPaths(stepBlock, REQUIRED_COMPAT_CI_UPLOAD_STEP_NAME);
    const expectedPaths = REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_FILES.map(
      (artifactFile) => `${REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_PATH_PREFIX}${artifactFile}`
    );
    expect(artifactName).toBe(REQUIRED_COMPAT_CI_UPLOAD_ARTIFACT_NAME);
    expect(ifNoFilesFoundValue).toBe(REQUIRED_COMPAT_CI_UPLOAD_IF_NO_FILES_FOUND);
    expect(uploadPaths).toEqual(expectedPaths);
  });
});
