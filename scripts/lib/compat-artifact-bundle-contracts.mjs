export const REQUIRED_COMPAT_ARTIFACT_BUNDLE_ARTIFACT_NAMES = Object.freeze([
  'summary.json',
  'report-schema-validator-result.json',
  'validator-result.json',
  'schema-validator-result.json',
  'validator-result-verifier-result.json',
  'artifact-bundle-manifest-validator-result.json'
]);

export const REQUIRED_COMPAT_ARTIFACT_BUNDLE_ARTIFACT_COUNT = REQUIRED_COMPAT_ARTIFACT_BUNDLE_ARTIFACT_NAMES.length;

export const REQUIRED_COMPAT_ARTIFACT_BUNDLE_ARTIFACT_FILES = Object.freeze(
  Object.fromEntries(
    REQUIRED_COMPAT_ARTIFACT_BUNDLE_ARTIFACT_NAMES.map((artifactName) => [artifactName, artifactName])
  )
);

export const REQUIRED_COMPAT_ARTIFACT_BUNDLE_SCHEMA_PATHS = Object.freeze({
  'summary.json': 'schemas/compat-summary.schema.json',
  'report-schema-validator-result.json': 'schemas/compat-report-schema-validator-output.schema.json',
  'validator-result.json': 'schemas/compat-summary-validator-output.schema.json',
  'schema-validator-result.json': 'schemas/json-schema-validator-output.schema.json',
  'validator-result-verifier-result.json': 'schemas/compat-validator-result-verifier-output.schema.json',
  'artifact-bundle-manifest-validator-result.json': 'schemas/compat-artifact-bundle-manifest-validator-output.schema.json'
});

export const REQUIRED_COMPAT_ARTIFACT_BUNDLE_SCHEMA_IDS = Object.freeze(
  Object.fromEntries(
    Object.entries(REQUIRED_COMPAT_ARTIFACT_BUNDLE_SCHEMA_PATHS).map(([artifactName, schemaPath]) => (
      [artifactName, `https://clawvault.dev/${schemaPath}`]
    ))
  )
);

export const REQUIRED_COMPAT_ARTIFACT_BUNDLE_VERSION_FIELDS = Object.freeze({
  'summary.json': 'summarySchemaVersion',
  'report-schema-validator-result.json': 'outputSchemaVersion',
  'validator-result.json': 'outputSchemaVersion',
  'schema-validator-result.json': 'outputSchemaVersion',
  'validator-result-verifier-result.json': 'outputSchemaVersion',
  'artifact-bundle-manifest-validator-result.json': 'outputSchemaVersion'
});

export const REQUIRED_COMPAT_ARTIFACT_BUNDLE_PATH_FIELDS = Object.freeze([
  Object.freeze({ fieldName: 'summaryPath', artifactName: 'summary.json' }),
  Object.freeze({ fieldName: 'validatorResultPath', artifactName: 'validator-result.json' }),
  Object.freeze({ fieldName: 'reportSchemaValidatorResultPath', artifactName: 'report-schema-validator-result.json' }),
  Object.freeze({ fieldName: 'schemaValidatorResultPath', artifactName: 'schema-validator-result.json' }),
  Object.freeze({ fieldName: 'validatorResultVerifierResultPath', artifactName: 'validator-result-verifier-result.json' }),
  Object.freeze({ fieldName: 'artifactBundleManifestValidatorResultPath', artifactName: 'artifact-bundle-manifest-validator-result.json' })
]);
