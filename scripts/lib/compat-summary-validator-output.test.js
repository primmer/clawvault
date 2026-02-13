import { describe, expect, it } from 'vitest';
import {
  buildSummaryValidatorErrorPayload,
  buildSummaryValidatorSuccessPayload,
  COMPAT_SUMMARY_VALIDATOR_OUTPUT_SCHEMA_VERSION,
  ensureSummaryValidatorPayloadShape
} from './compat-summary-validator-output.mjs';

describe('compat summary validator output payload contracts', () => {
  it('builds and validates success payloads', () => {
    const payload = buildSummaryValidatorSuccessPayload({
      mode: 'fixtures',
      summarySchemaVersion: 1,
      fixtureSchemaVersion: 2,
      selectedTotal: 3,
      resultCount: 3,
      summaryPath: '/tmp/summary.json',
      reportDir: '/tmp',
      caseReportMode: 'validated-case-reports'
    });
    expect(payload.outputSchemaVersion).toBe(COMPAT_SUMMARY_VALIDATOR_OUTPUT_SCHEMA_VERSION);
    expect(() => ensureSummaryValidatorPayloadShape(payload)).not.toThrow();
  });

  it('builds and validates error payloads', () => {
    const payload = buildSummaryValidatorErrorPayload('boom');
    expect(payload).toEqual({
      outputSchemaVersion: COMPAT_SUMMARY_VALIDATOR_OUTPUT_SCHEMA_VERSION,
      status: 'error',
      error: 'boom'
    });
    expect(() => ensureSummaryValidatorPayloadShape(payload)).not.toThrow();
  });

  it('rejects malformed payload shapes', () => {
    expect(() => ensureSummaryValidatorPayloadShape({
      outputSchemaVersion: COMPAT_SUMMARY_VALIDATOR_OUTPUT_SCHEMA_VERSION,
      status: 'ok',
      mode: 'fixtures'
    })).toThrow('summarySchemaVersion');

    expect(() => ensureSummaryValidatorPayloadShape({
      outputSchemaVersion: COMPAT_SUMMARY_VALIDATOR_OUTPUT_SCHEMA_VERSION,
      status: 'error',
      error: ''
    })).toThrow('field "error"');

    expect(() => buildSummaryValidatorSuccessPayload({
      mode: 'fixtures',
      summarySchemaVersion: 1,
      fixtureSchemaVersion: 2,
      selectedTotal: 3,
      resultCount: 3,
      summaryPath: '/tmp/summary.json',
      reportDir: '/tmp',
      caseReportMode: 'unknown'
    })).toThrow('caseReportMode');
  });
});
