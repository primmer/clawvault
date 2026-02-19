import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { shellInit } from './shell-init.js';
function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
describe('shellInit', () => {
    it('uses CLAWVAULT_PATH from env when provided', () => {
        const output = shellInit({
            env: { CLAWVAULT_PATH: '/tmp/vault' },
            cwd: '/'
        });
        expect(output).toContain(`export CLAWVAULT_PATH='${path.resolve('/tmp/vault')}'`);
        expect(output).toContain("alias cvwake='clawvault wake'");
        expect(output).toContain("alias cvsleep='clawvault sleep'");
        expect(output).toContain("alias cvcheck='clawvault doctor'");
    });
    it('detects a vault path from cwd when env is empty', () => {
        const dir = makeTempDir('clawvault-shell-');
        try {
            fs.writeFileSync(path.join(dir, '.clawvault.json'), '{}');
            const output = shellInit({
                env: {},
                cwd: dir
            });
            expect(output).toContain(`export CLAWVAULT_PATH='${dir}'`);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=shell-init.test.js.map