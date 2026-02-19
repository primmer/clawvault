import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn()
}));

vi.mock('child_process', () => ({
  spawnSync: spawnSyncMock
}));

async function loadCompatModule() {
  vi.resetModules();
  return await import('./compat.js');
}

function writeProjectFixture(root: string): void {
  fs.mkdirSync(path.join(root, 'dist', 'plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'clawvault',
      openclaw: { extensions: ['./dist/plugin/index.js'] }
    }),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(root, 'openclaw.plugin.json'),
    JSON.stringify({
      id: 'clawvault',
      kind: 'memory',
      configSchema: { type: 'object', properties: {} }
    }),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(root, 'dist', 'plugin', 'index.js'),
    'export default { id: "clawvault", register() {} };',
    'utf-8'
  );
  fs.writeFileSync(
    path.join(root, 'SKILL.md'),
    '---\nmetadata: {"openclaw":{"emoji":"🐘"}}\n---',
    'utf-8'
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('checkOpenClawCompatibility', () => {
  it('returns healthy report for valid fixtures', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-compat-'));
    try {
      writeProjectFixture(root);
      const { checkOpenClawCompatibility } = await loadCompatModule();
      const report = checkOpenClawCompatibility({ baseDir: root });
      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses installed package metadata by default when cwd package is unrelated', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined, status: 0 });
    const cwdFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-compat-cwd-'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwdFixture);
    try {
      fs.writeFileSync(
        path.join(cwdFixture, 'package.json'),
        JSON.stringify({
          name: 'unrelated-app',
          version: '0.0.1'
        }),
        'utf-8'
      );
      const { checkOpenClawCompatibility } = await loadCompatModule();
      const report = checkOpenClawCompatibility();
      const extCheck = report.checks.find(
        (check) => check.label === 'plugin extensions registration'
      );
      expect(extCheck?.status).toBe('ok');
      expect(extCheck?.detail).toContain('./dist/plugin/index.js');
    } finally {
      cwdSpy.mockRestore();
      fs.rmSync(cwdFixture, { recursive: true, force: true });
    }
  });

  it('flags missing openclaw binary as warning', async () => {
    spawnSyncMock.mockReturnValue({ error: new Error('missing') });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-compat-'));
    try {
      writeProjectFixture(root);
      const { checkOpenClawCompatibility } = await loadCompatModule();
      const report = checkOpenClawCompatibility({ baseDir: root });
      const cliCheck = report.checks.find(
        (check) => check.label === 'openclaw CLI available'
      );
      expect(cliCheck?.status).toBe('warn');
      expect(report.warnings).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags unusable openclaw binary when version command exits non-zero', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined, status: 2 });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-compat-'));
    try {
      writeProjectFixture(root);
      const { checkOpenClawCompatibility } = await loadCompatModule();
      const report = checkOpenClawCompatibility({ baseDir: root });
      const cliCheck = report.checks.find(
        (check) => check.label === 'openclaw CLI available'
      );
      expect(cliCheck?.status).toBe('warn');
      expect(cliCheck?.detail).toContain('exited with code 2');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags openclaw CLI termination by signal as warning', async () => {
    spawnSyncMock.mockReturnValue({
      error: undefined,
      status: null,
      signal: 'SIGTERM'
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-compat-'));
    try {
      writeProjectFixture(root);
      const { checkOpenClawCompatibility } = await loadCompatModule();
      const report = checkOpenClawCompatibility({ baseDir: root });
      const cliCheck = report.checks.find(
        (check) => check.label === 'openclaw CLI available'
      );
      expect(cliCheck?.status).toBe('warn');
      expect(cliCheck?.detail).toContain('terminated by signal SIGTERM');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('computes strict exit code from warnings/errors', async () => {
    const { compatibilityExitCode } = await loadCompatModule();
    expect(
      compatibilityExitCode({
        generatedAt: '',
        checks: [],
        warnings: 0,
        errors: 0
      })
    ).toBe(0);
    expect(
      compatibilityExitCode({
        generatedAt: '',
        checks: [],
        warnings: 1,
        errors: 0
      })
    ).toBe(0);
    expect(
      compatibilityExitCode(
        { generatedAt: '', checks: [], warnings: 1, errors: 0 },
        { strict: true }
      )
    ).toBe(1);
    expect(
      compatibilityExitCode({
        generatedAt: '',
        checks: [],
        warnings: 0,
        errors: 1
      })
    ).toBe(1);
  });

  it('flags missing plugin manifest', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-compat-'));
    try {
      writeProjectFixture(root);
      fs.unlinkSync(path.join(root, 'openclaw.plugin.json'));
      const { checkOpenClawCompatibility } = await loadCompatModule();
      const report = checkOpenClawCompatibility({ baseDir: root });
      const manifestCheck = report.checks.find(
        (check) => check.label === 'plugin manifest'
      );
      expect(manifestCheck?.status).toBe('error');
      expect(manifestCheck?.detail).toContain('openclaw.plugin.json not found');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags missing openclaw.extensions in package.json', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-compat-'));
    try {
      writeProjectFixture(root);
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'clawvault' }),
        'utf-8'
      );
      const { checkOpenClawCompatibility } = await loadCompatModule();
      const report = checkOpenClawCompatibility({ baseDir: root });
      const extCheck = report.checks.find(
        (check) => check.label === 'plugin extensions registration'
      );
      expect(extCheck?.status).toBe('error');
      expect(extCheck?.detail).toContain('Missing openclaw.extensions');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags missing extension entry files', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-compat-'));
    try {
      writeProjectFixture(root);
      fs.unlinkSync(path.join(root, 'dist', 'plugin', 'index.js'));
      const { checkOpenClawCompatibility } = await loadCompatModule();
      const report = checkOpenClawCompatibility({ baseDir: root });
      const extCheck = report.checks.find(
        (check) => check.label === 'plugin extensions registration'
      );
      expect(extCheck?.status).toBe('error');
      expect(extCheck?.detail).toContain('Entry file(s) not found');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags malformed SKILL frontmatter with actionable warning', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined, status: 0 });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-compat-'));
    try {
      writeProjectFixture(root);
      fs.writeFileSync(
        path.join(root, 'SKILL.md'),
        '---\nmetadata: [\n---\ninvalid',
        'utf-8'
      );
      const { checkOpenClawCompatibility } = await loadCompatModule();
      const report = checkOpenClawCompatibility({ baseDir: root });
      const skillCheck = report.checks.find(
        (check) => check.label === 'skill metadata'
      );
      expect(skillCheck?.status).toBe('warn');
      expect(skillCheck?.detail).toContain(
        'Unable to parse SKILL.md frontmatter'
      );
      expect(skillCheck?.hint).toContain('metadata.openclaw');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('matches declarative compatibility fixture expectations', async () => {
    const { checkOpenClawCompatibility, compatibilityExitCode } =
      await loadCompatModule();
    const casesPath = path.resolve(
      process.cwd(),
      'tests',
      'compat-fixtures',
      'cases.json'
    );
    const manifest = JSON.parse(fs.readFileSync(casesPath, 'utf-8')) as {
      schemaVersion: number;
      expectedCheckLabels: string[];
      cases: Array<{
        name: string;
        description: string;
        expectedExitCode: number;
        expectedWarnings: number;
        expectedErrors: number;
        expectedCheckStatuses: Record<string, 'ok' | 'warn' | 'error'>;
        expectedDetailIncludes?: Record<string, string>;
        expectedHintIncludes?: Record<string, string>;
        openclawExitCode?: number;
        openclawSignal?: string;
        openclawMissing?: boolean;
      }>;
    };
    const cases = manifest.cases;

    for (const testCase of cases) {
      const spawnResult = testCase.openclawSignal
        ? {
            error: undefined,
            status: null,
            signal: testCase.openclawSignal
          }
        : testCase.openclawMissing
          ? { error: new Error('missing') }
          : testCase.openclawExitCode === undefined
            ? { error: undefined, status: 0 }
            : { error: undefined, status: testCase.openclawExitCode };
      spawnSyncMock.mockReturnValueOnce(spawnResult);
      const fixtureRoot = path.resolve(
        process.cwd(),
        'tests',
        'compat-fixtures',
        testCase.name
      );
      const report = checkOpenClawCompatibility({ baseDir: fixtureRoot });
      expect(report.checks.map((check) => check.label)).toEqual(
        manifest.expectedCheckLabels
      );
      expect(report.warnings).toBe(testCase.expectedWarnings);
      expect(report.errors).toBe(testCase.expectedErrors);
      expect(compatibilityExitCode(report, { strict: true })).toBe(
        testCase.expectedExitCode
      );

      for (const [label, expectedStatus] of Object.entries(
        testCase.expectedCheckStatuses
      )) {
        const check = report.checks.find(
          (candidate) => candidate.label === label
        );
        expect(check?.status).toBe(expectedStatus);
      }

      for (const [label, expectedSnippet] of Object.entries(
        testCase.expectedDetailIncludes ?? {}
      )) {
        const check = report.checks.find(
          (candidate) => candidate.label === label
        );
        expect(check?.detail).toContain(expectedSnippet);
      }

      for (const [label, expectedSnippet] of Object.entries(
        testCase.expectedHintIncludes ?? {}
      )) {
        const check = report.checks.find(
          (candidate) => candidate.label === label
        );
        expect(check?.hint).toContain(expectedSnippet);
      }
    }
  });
});
