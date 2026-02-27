import { describe, it, expect } from 'vitest';
import { resolveInitFlags } from './register-core-commands.js';

describe('resolveInitFlags', () => {
  it('maps --no-tasks and --no-graph style options', () => {
    const flags = resolveInitFlags({
      minimal: false,
      bases: false,
      tasks: false,
      graph: false,
    });

    expect(flags).toEqual({
      skipBases: true,
      skipTasks: true,
      skipGraph: true,
    });
  });

  it('maps --minimal to all skip flags', () => {
    const flags = resolveInitFlags({
      minimal: true,
      bases: true,
      tasks: true,
      graph: true,
    });

    expect(flags).toEqual({
      skipBases: true,
      skipTasks: true,
      skipGraph: true,
    });
  });

  it('keeps defaults when no skip options provided', () => {
    const flags = resolveInitFlags({
      minimal: false,
      bases: true,
      tasks: true,
      graph: true,
    });

    expect(flags).toEqual({
      skipBases: false,
      skipTasks: false,
      skipGraph: false,
    });
  });
});
