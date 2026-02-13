import * as path from 'path';
import {
  loadCompatSummary,
  validateCompatSummaryCaseReports
} from './lib/compat-fixture-runner.mjs';

function parseCliArgs(argv) {
  const parsed = {
    summaryPath: '',
    reportDir: ''
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--summary') {
      const nextValue = argv[index + 1];
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('Missing value for --summary');
      }
      parsed.summaryPath = nextValue;
      index += 1;
      continue;
    }
    if (value === '--report-dir') {
      const nextValue = argv[index + 1];
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('Missing value for --report-dir');
      }
      parsed.reportDir = nextValue;
      index += 1;
      continue;
    }
    if (value.startsWith('--')) {
      throw new Error(`Unknown option: ${value}`);
    }
    positional.push(value);
  }

  if (!parsed.summaryPath && positional.length > 0) {
    parsed.summaryPath = positional[0];
  }

  return parsed;
}

function resolvePaths(args) {
  const reportDir = args.reportDir && args.reportDir.trim()
    ? path.resolve(process.cwd(), args.reportDir)
    : (
      process.env.COMPAT_REPORT_DIR && process.env.COMPAT_REPORT_DIR.trim()
        ? path.resolve(process.cwd(), process.env.COMPAT_REPORT_DIR)
        : ''
    );

  if (args.summaryPath && args.summaryPath.trim()) {
    const summaryPath = path.resolve(process.cwd(), args.summaryPath);
    return {
      summaryPath,
      reportDir: reportDir || path.dirname(summaryPath)
    };
  }

  if (process.env.COMPAT_SUMMARY_PATH && process.env.COMPAT_SUMMARY_PATH.trim()) {
    const summaryPath = path.resolve(process.cwd(), process.env.COMPAT_SUMMARY_PATH);
    return {
      summaryPath,
      reportDir: reportDir || path.dirname(summaryPath)
    };
  }

  if (reportDir) {
    return {
      summaryPath: path.join(reportDir, 'summary.json'),
      reportDir
    };
  }

  throw new Error('Missing summary path. Provide <summary.json>, COMPAT_SUMMARY_PATH, or COMPAT_REPORT_DIR.');
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const { summaryPath, reportDir } = resolvePaths(args);
  const summary = loadCompatSummary(summaryPath);
  validateCompatSummaryCaseReports(summary, reportDir);

  const resultCount = Array.isArray(summary.results) ? summary.results.length : 0;
  console.log(
    `Compatibility summary validation passed (${summary.mode}) selected=${summary.selectedTotal} results=${resultCount} reportDir=${reportDir}`
  );
}

try {
  main();
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}
