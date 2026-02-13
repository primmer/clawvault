import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  buildCompatSummaryHeader,
  COMPAT_FIXTURE_SCHEMA_VERSION
} from './lib/compat-fixture-runner.mjs';

const reportSchemaValidatorScript = path.resolve(process.cwd(), 'scripts', 'validate-compat-report-schemas.mjs');

function runReportSchemaValidator(args = [], env = {}) {
  return spawnSync(
    process.execPath,
    [reportSchemaValidatorScript, ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: 'utf-8'
    }
  );
}

function buildFixturesSummary() {
  return {
    ...buildCompatSummaryHeader({
      generatedAt: '2026-02-13T00:00:00.000Z',
      mode: 'fixtures',
      schemaVersion: COMPAT_FIXTURE_SCHEMA_VERSION,
      selectedCases: ['healthy'],
      expectedCheckLabels: ['openclaw CLI available'],
      runtimeCheckLabels: ['openclaw CLI available']
    }),
    total: 1,
    preflightDurationMs: 10,
    totalDurationMs: 20,
    averageDurationMs: 20,
    overallDurationMs: 30,
    slowestCases: [{ name: 'healthy', durationMs: 20 }],
    failures: 0,
    passedCases: ['healthy'],
    failedCases: [],
    results: [{
      name: 'healthy',
      expectedExitCode: 0,
      actualExitCode: 0,
      passed: true,
      durationMs: 20,
      mismatches: []
    }]
  };
}

describe('validate-compat-report-schemas script', () => {
  it('validates summary and case reports with default schema paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-report-schema-'));
    try {
      fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(buildFixturesSummary(), null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(root, 'healthy.json'),
        JSON.stringify({
          generatedAt: '2026-02-13T00:00:00.000Z',
          warnings: 0,
          errors: 0,
          checks: [{ label: 'openclaw CLI available', status: 'ok' }]
        }, null, 2),
        'utf-8'
      );

      const result = runReportSchemaValidator([], { COMPAT_REPORT_DIR: root });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Compatibility report schema validation passed');
      expect(result.stdout).toContain('validatedCaseReports=1');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails on invalid case reports and supports allow-missing mode', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-report-schema-'));
    try {
      fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(buildFixturesSummary(), null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(root, 'healthy.json'),
        JSON.stringify({
          generatedAt: '2026-02-13T00:00:00.000Z',
          warnings: 0,
          errors: 0,
          checks: [{ label: 'openclaw CLI available', status: 'invalid' }]
        }, null, 2),
        'utf-8'
      );

      const invalidResult = runReportSchemaValidator([], { COMPAT_REPORT_DIR: root });
      expect(invalidResult.status).toBe(1);
      expect(invalidResult.stderr).toContain('Schema validation failed for compat case report (healthy)');

      fs.rmSync(path.join(root, 'healthy.json'));
      const missingResult = runReportSchemaValidator([], { COMPAT_REPORT_DIR: root });
      expect(missingResult.status).toBe(1);
      expect(missingResult.stderr).toContain('Missing case report for summary result: healthy');

      const allowMissingResult = runReportSchemaValidator(['--allow-missing-case-reports'], { COMPAT_REPORT_DIR: root });
      expect(allowMissingResult.status).toBe(0);
      expect(allowMissingResult.stdout).toContain('skipped-case-reports');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('prints usage help and handles unknown options', () => {
    const helpResult = runReportSchemaValidator(['--help']);
    expect(helpResult.status).toBe(0);
    expect(helpResult.stdout).toContain('Usage: node scripts/validate-compat-report-schemas.mjs');
    expect(helpResult.stdout).toContain('--summary-schema <schema.json>');

    const unknownResult = runReportSchemaValidator(['--unknown']);
    expect(unknownResult.status).toBe(1);
    expect(unknownResult.stderr).toContain('Unknown option: --unknown');
  });
});
