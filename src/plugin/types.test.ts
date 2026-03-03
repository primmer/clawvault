import { describe, expect, it } from 'vitest';
import { parseScope, matchesScope, DEFAULT_RETRIEVAL_CONFIG } from './types.js';

describe('parseScope', () => {
  it('parses global scope', () => {
    expect(parseScope('global')).toBe('global');
  });

  it('parses agent scope', () => {
    expect(parseScope('agent:claude')).toBe('agent:claude');
  });

  it('parses project scope', () => {
    expect(parseScope('project:clawvault')).toBe('project:clawvault');
  });

  it('parses user scope', () => {
    expect(parseScope('user:pedro')).toBe('user:pedro');
  });

  it('defaults to global for unknown scope', () => {
    expect(parseScope('unknown')).toBe('global');
    expect(parseScope('')).toBe('global');
    expect(parseScope('invalid:format:extra')).toBe('global');
  });
});

describe('matchesScope', () => {
  it('global filter matches everything', () => {
    expect(matchesScope('global', 'global')).toBe(true);
    expect(matchesScope('agent:claude', 'global')).toBe(true);
    expect(matchesScope('project:test', 'global')).toBe(true);
  });

  it('specific filter matches only same scope', () => {
    expect(matchesScope('agent:claude', 'agent:claude')).toBe(true);
    expect(matchesScope('agent:claude', 'agent:other')).toBe(false);
    expect(matchesScope('global', 'agent:claude')).toBe(false);
  });

  it('project scope matching', () => {
    expect(matchesScope('project:clawvault', 'project:clawvault')).toBe(true);
    expect(matchesScope('project:other', 'project:clawvault')).toBe(false);
  });
});

describe('DEFAULT_RETRIEVAL_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_RETRIEVAL_CONFIG.bm25Weight).toBe(0.5);
    expect(DEFAULT_RETRIEVAL_CONFIG.semanticWeight).toBe(0.5);
    expect(DEFAULT_RETRIEVAL_CONFIG.rrfK).toBe(60);
    expect(DEFAULT_RETRIEVAL_CONFIG.topK).toBe(10);
    expect(DEFAULT_RETRIEVAL_CONFIG.recencyHalfLifeDays).toBe(14);
    expect(DEFAULT_RETRIEVAL_CONFIG.recencyWeight).toBe(0.10);
    expect(DEFAULT_RETRIEVAL_CONFIG.decayHalfLifeDays).toBe(60);
    expect(DEFAULT_RETRIEVAL_CONFIG.lengthNormAnchor).toBe(500);
    expect(DEFAULT_RETRIEVAL_CONFIG.mmrLambda).toBe(0.7);
    expect(DEFAULT_RETRIEVAL_CONFIG.rerankWeight).toBe(0.6);
    expect(DEFAULT_RETRIEVAL_CONFIG.minScore).toBe(0.01);
  });

  it('does not have reranker configured by default', () => {
    expect(DEFAULT_RETRIEVAL_CONFIG.rerankProvider).toBeUndefined();
    expect(DEFAULT_RETRIEVAL_CONFIG.rerankApiKey).toBeUndefined();
  });
});
