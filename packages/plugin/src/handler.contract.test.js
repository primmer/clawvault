import { describe, expect, it } from 'vitest';
import handler from './handler.js';

describe('@clawvault/memory-plugin contract', () => {
  it('exports a callable hook handler', () => {
    expect(typeof handler).toBe('function');
  });
});
