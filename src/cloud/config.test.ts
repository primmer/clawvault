import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCloudConfig, updateCloudConfig } from './config.js';
import { getCloudConfigPath } from './paths.js';

describe('cloud config', () => {
  let tempDir: string;
  const originalHome = process.env.CLAWVAULT_HOME;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-cloud-config-'));
    process.env.CLAWVAULT_HOME = tempDir;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.CLAWVAULT_HOME;
    } else {
      process.env.CLAWVAULT_HOME = originalHome;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts empty and persists updated values', () => {
    expect(readCloudConfig()).toEqual({});

    updateCloudConfig({
      cloudApiKey: 'cvk_test_1234',
      cloudVaultId: 'vault-123',
      cloudOrgSlug: 'my-org'
    });

    const saved = readCloudConfig();
    expect(saved.cloudApiKey).toBe('cvk_test_1234');
    expect(saved.cloudVaultId).toBe('vault-123');
    expect(saved.cloudOrgSlug).toBe('my-org');
    expect(fs.existsSync(getCloudConfigPath())).toBe(true);
  });
});
