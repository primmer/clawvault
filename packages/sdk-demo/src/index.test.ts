import { describe, expect, it } from 'vitest';
import {
  DemoWorkgraphSdk,
  runWorkgraphJson,
  type WorkgraphRunner,
} from './index.js';

describe('@clawvault/sdk-demo', () => {
  it('parses JSON envelope from workgraph command output', () => {
    let capturedArgs: string[] = [];
    const runner: WorkgraphRunner = (_command, args) => {
      capturedArgs = args;
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, data: { value: 42 } }),
        stderr: '',
      };
    };

    const result = runWorkgraphJson<{ value: number }>(
      ['ledger', 'show'],
      { workspacePath: '/tmp/wg', runner }
    );

    expect(result.ok).toBe(true);
    expect(result.data?.value).toBe(42);
    expect(capturedArgs).toContain('--json');
    expect(capturedArgs).toContain('--workspace');
    expect(capturedArgs).toContain('/tmp/wg');
  });

  it('returns descriptive error when output is not JSON', () => {
    const runner: WorkgraphRunner = () => ({
      status: 0,
      stdout: 'non-json-output',
      stderr: '',
    });

    const result = runWorkgraphJson(['thread', 'list'], { runner });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('non-JSON');
  });

  it('builds skill lifecycle calls through sdk methods', () => {
    const invocations: string[][] = [];
    const runner: WorkgraphRunner = (_command, args) => {
      invocations.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({ ok: true, data: {} }),
        stderr: '',
      };
    };

    const sdk = new DemoWorkgraphSdk('/tmp/demo', 'agent-demo', runner);
    sdk.writeSkill('workgraph-manual', '# guide');
    sdk.proposeSkill('workgraph-manual');
    sdk.promoteSkill('workgraph-manual');

    expect(invocations[0]).toEqual(expect.arrayContaining(['skill', 'write', 'workgraph-manual', '--actor', 'agent-demo']));
    expect(invocations[1]).toEqual(expect.arrayContaining(['skill', 'propose', 'workgraph-manual', '--actor', 'agent-demo']));
    expect(invocations[2]).toEqual(expect.arrayContaining(['skill', 'promote', 'workgraph-manual', '--actor', 'agent-demo']));
  });
});
