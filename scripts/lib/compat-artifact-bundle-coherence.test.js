import { describe, expect, it } from 'vitest';
import * as path from 'path';
import {
  ensureArtifactPathCoherence,
  ensureCrossPayloadCoherence,
  ensureManifestValidatorPayloadCoherence,
  ensureRequiredArtifactNamesPresent,
  ensureRequireOkStatuses
} from './compat-artifact-bundle-coherence.mjs';

function buildBaseFixtureState() {
  const reportDir = '/tmp/compat-report-dir';
  const manifestPath = '/workspace/schemas/compat-artifact-bundle.manifest.json';
  const artifactContracts = [
    {
      artifactName: 'summary.json',
      artifactFile: 'summary.json',
      schemaPathResolved: path.resolve(process.cwd(), 'schemas', 'compat-summary.schema.json'),
      schemaId: 'https://clawvault.dev/schemas/compat-summary.schema.json',
      versionField: 'summarySchemaVersion'
    },
    {
      artifactName: 'report-schema-validator-result.json',
      artifactFile: 'report-schema-validator-result.json',
      schemaPathResolved: path.resolve(process.cwd(), 'schemas', 'compat-report-schema-validator-output.schema.json'),
      schemaId: 'https://clawvault.dev/schemas/compat-report-schema-validator-output.schema.json',
      versionField: 'outputSchemaVersion'
    },
    {
      artifactName: 'validator-result.json',
      artifactFile: 'validator-result.json',
      schemaPathResolved: path.resolve(process.cwd(), 'schemas', 'compat-summary-validator-output.schema.json'),
      schemaId: 'https://clawvault.dev/schemas/compat-summary-validator-output.schema.json',
      versionField: 'outputSchemaVersion'
    },
    {
      artifactName: 'schema-validator-result.json',
      artifactFile: 'schema-validator-result.json',
      schemaPathResolved: path.resolve(process.cwd(), 'schemas', 'json-schema-validator-output.schema.json'),
      schemaId: 'https://clawvault.dev/schemas/json-schema-validator-output.schema.json',
      versionField: 'outputSchemaVersion'
    },
    {
      artifactName: 'validator-result-verifier-result.json',
      artifactFile: 'validator-result-verifier-result.json',
      schemaPathResolved: path.resolve(process.cwd(), 'schemas', 'compat-validator-result-verifier-output.schema.json'),
      schemaId: 'https://clawvault.dev/schemas/compat-validator-result-verifier-output.schema.json',
      versionField: 'outputSchemaVersion'
    },
    {
      artifactName: 'artifact-bundle-manifest-validator-result.json',
      artifactFile: 'artifact-bundle-manifest-validator-result.json',
      schemaPathResolved: path.resolve(process.cwd(), 'schemas', 'compat-artifact-bundle-manifest-validator-output.schema.json'),
      schemaId: 'https://clawvault.dev/schemas/compat-artifact-bundle-manifest-validator-output.schema.json',
      versionField: 'outputSchemaVersion'
    }
  ];
  const artifactPathByName = new Map(
    artifactContracts.map((entry) => [entry.artifactName, path.join(reportDir, entry.artifactFile)])
  );

  return {
    reportDir,
    manifestPath,
    artifactContracts,
    artifactPathByName,
    summary: {
      mode: 'fixtures',
      summarySchemaVersion: 1,
      schemaVersion: 2,
      selectedTotal: 1,
      results: [{ name: 'healthy' }]
    },
    summaryValidatorPayload: {
      status: 'ok',
      mode: 'fixtures',
      summarySchemaVersion: 1,
      fixtureSchemaVersion: 2,
      selectedTotal: 1,
      resultCount: 1,
      summaryPath: path.join(reportDir, 'summary.json'),
      reportDir,
      caseReportMode: 'validated-case-reports',
      outputSchemaVersion: 1
    },
    reportSchemaValidatorPayload: {
      status: 'ok',
      mode: 'fixtures',
      summaryPath: path.join(reportDir, 'summary.json'),
      reportDir,
      caseReportMode: 'validated-case-reports',
      validatedCaseReports: 1
    },
    schemaValidatorPayload: {
      status: 'ok',
      dataPath: path.join(reportDir, 'validator-result.json'),
      schemaPath: path.resolve(process.cwd(), 'schemas', 'compat-summary-validator-output.schema.json')
    },
    validatorResultVerifierPayload: {
      status: 'ok',
      payloadPath: path.join(reportDir, 'validator-result.json'),
      payloadStatus: 'ok',
      validatorPayloadOutputSchemaVersion: 1
    },
    artifactBundleManifestValidatorPayload: {
      status: 'ok',
      manifestPath,
      artifactCount: artifactContracts.length,
      artifacts: artifactContracts.map((entry) => entry.artifactName),
      schemaContracts: artifactContracts.map((entry) => ({
        artifactName: entry.artifactName,
        artifactFile: entry.artifactFile,
        schemaPath: entry.schemaPathResolved,
        schemaId: entry.schemaId,
        versionField: entry.versionField,
        expectedSchemaVersion: 1
      }))
    },
    artifactContractEntries: artifactContracts.map((entry) => ({
      artifactName: entry.artifactName,
      expectedSchemaVersion: 1
    }))
  };
}

describe('compat artifact bundle coherence helpers', () => {
  it('validates required artifact names', () => {
    const fixture = buildBaseFixtureState();
    expect(() => ensureRequiredArtifactNamesPresent(
      fixture.artifactContracts,
      ['summary.json', 'validator-result.json']
    )).not.toThrow();
    expect(() => ensureRequiredArtifactNamesPresent(
      fixture.artifactContracts,
      ['missing-artifact.json']
    )).toThrow('missing required artifactName');
  });

  it('validates path coherence and detects drift', () => {
    const fixture = buildBaseFixtureState();
    expect(() => ensureArtifactPathCoherence({
      summaryValidatorPayload: fixture.summaryValidatorPayload,
      reportSchemaValidatorPayload: fixture.reportSchemaValidatorPayload,
      schemaValidatorPayload: fixture.schemaValidatorPayload,
      validatorResultVerifierPayload: fixture.validatorResultVerifierPayload,
      artifactBundleManifestValidatorPayload: fixture.artifactBundleManifestValidatorPayload,
      artifactPathByName: fixture.artifactPathByName,
      reportDir: fixture.reportDir,
      manifestPath: fixture.manifestPath
    })).not.toThrow();

    fixture.summaryValidatorPayload.reportDir = '/tmp/drifted-report-dir';
    expect(() => ensureArtifactPathCoherence({
      summaryValidatorPayload: fixture.summaryValidatorPayload,
      reportSchemaValidatorPayload: fixture.reportSchemaValidatorPayload,
      schemaValidatorPayload: fixture.schemaValidatorPayload,
      validatorResultVerifierPayload: fixture.validatorResultVerifierPayload,
      artifactBundleManifestValidatorPayload: fixture.artifactBundleManifestValidatorPayload,
      artifactPathByName: fixture.artifactPathByName,
      reportDir: fixture.reportDir,
      manifestPath: fixture.manifestPath
    })).toThrow('validator-result reportDir mismatch');
  });

  it('validates cross payload coherence and detects selected total drift', () => {
    const fixture = buildBaseFixtureState();
    expect(() => ensureCrossPayloadCoherence({
      summary: fixture.summary,
      summaryValidatorPayload: fixture.summaryValidatorPayload,
      reportSchemaValidatorPayload: fixture.reportSchemaValidatorPayload,
      validatorResultVerifierPayload: fixture.validatorResultVerifierPayload,
      schemaValidatorPayload: fixture.schemaValidatorPayload,
      artifactContracts: fixture.artifactContracts
    })).not.toThrow();

    fixture.summaryValidatorPayload.selectedTotal = 99;
    expect(() => ensureCrossPayloadCoherence({
      summary: fixture.summary,
      summaryValidatorPayload: fixture.summaryValidatorPayload,
      reportSchemaValidatorPayload: fixture.reportSchemaValidatorPayload,
      validatorResultVerifierPayload: fixture.validatorResultVerifierPayload,
      schemaValidatorPayload: fixture.schemaValidatorPayload,
      artifactContracts: fixture.artifactContracts
    })).toThrow('selected total mismatch between summary and validator-result payload');
  });

  it('enforces require-ok status gate', () => {
    const fixture = buildBaseFixtureState();
    expect(() => ensureRequireOkStatuses({
      requireOk: true,
      reportSchemaValidatorPayload: fixture.reportSchemaValidatorPayload,
      summaryValidatorPayload: fixture.summaryValidatorPayload,
      schemaValidatorPayload: fixture.schemaValidatorPayload,
      validatorResultVerifierPayload: fixture.validatorResultVerifierPayload,
      artifactBundleManifestValidatorPayload: fixture.artifactBundleManifestValidatorPayload
    })).not.toThrow();

    fixture.validatorResultVerifierPayload.status = 'error';
    expect(() => ensureRequireOkStatuses({
      requireOk: true,
      reportSchemaValidatorPayload: fixture.reportSchemaValidatorPayload,
      summaryValidatorPayload: fixture.summaryValidatorPayload,
      schemaValidatorPayload: fixture.schemaValidatorPayload,
      validatorResultVerifierPayload: fixture.validatorResultVerifierPayload,
      artifactBundleManifestValidatorPayload: fixture.artifactBundleManifestValidatorPayload
    })).toThrow('validator-result-verifier-result status is "error"');
  });

  it('validates manifest validator coherence and detects artifact list drift', () => {
    const fixture = buildBaseFixtureState();
    expect(() => ensureManifestValidatorPayloadCoherence({
      artifactBundleManifestValidatorPayload: fixture.artifactBundleManifestValidatorPayload,
      artifactContracts: fixture.artifactContracts,
      artifactContractEntries: fixture.artifactContractEntries
    })).not.toThrow();

    fixture.artifactBundleManifestValidatorPayload.artifacts = [
      ...fixture.artifactBundleManifestValidatorPayload.artifacts.slice(0, -1),
      'drifted-artifact.json'
    ];
    expect(() => ensureManifestValidatorPayloadCoherence({
      artifactBundleManifestValidatorPayload: fixture.artifactBundleManifestValidatorPayload,
      artifactContracts: fixture.artifactContracts,
      artifactContractEntries: fixture.artifactContractEntries
    })).toThrow('artifacts list does not match active manifest order');
  });
});
