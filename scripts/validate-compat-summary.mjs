import * as path from 'path';
import {
  loadCompatSummary,
  validateCompatSummaryCaseReports
} from './lib/compat-fixture-runner.mjs';

function resolveSummaryPath() {
  const cliPath = process.argv[2];
  if (cliPath && cliPath.trim()) {
    return path.resolve(process.cwd(), cliPath);
  }

  if (process.env.COMPAT_SUMMARY_PATH && process.env.COMPAT_SUMMARY_PATH.trim()) {
    return path.resolve(process.cwd(), process.env.COMPAT_SUMMARY_PATH);
  }

  if (process.env.COMPAT_REPORT_DIR && process.env.COMPAT_REPORT_DIR.trim()) {
    return path.join(path.resolve(process.cwd(), process.env.COMPAT_REPORT_DIR), 'summary.json');
  }

  throw new Error('Missing summary path. Provide <summary.json>, COMPAT_SUMMARY_PATH, or COMPAT_REPORT_DIR.');
}

function main() {
  const summaryPath = resolveSummaryPath();
  const summary = loadCompatSummary(summaryPath);
  validateCompatSummaryCaseReports(summary, path.dirname(summaryPath));

  const resultCount = Array.isArray(summary.results) ? summary.results.length : 0;
  console.log(
    `Compatibility summary validation passed (${summary.mode}) selected=${summary.selectedTotal} results=${resultCount}`
  );
}

try {
  main();
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}
