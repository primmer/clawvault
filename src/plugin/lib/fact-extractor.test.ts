import { describe, expect, it } from 'vitest';
import { extractFactsRuleBased } from './fact-extractor.js';

describe('extractFactsRuleBased', () => {
  it('extracts normalized facts from rule-based patterns', () => {
    const facts = extractFactsRuleBased([
      'I work at Acme Labs. Alice lives in Berlin.',
      'Alice likes TypeScript.'
    ]);

    expect(facts.some((fact) => fact.subject === 'user' && fact.predicate === 'works_at' && fact.object === 'Acme Labs')).toBe(true);
    expect(facts.some((fact) => fact.subject === 'Alice' && fact.predicate === 'lives_in' && fact.object === 'Berlin')).toBe(true);
    expect(facts.some((fact) => fact.subject === 'Alice' && fact.predicate === 'likes' && fact.object === 'TypeScript')).toBe(true);
  });

  it('deduplicates repeated facts across sentences', () => {
    const facts = extractFactsRuleBased([
      'Bob uses Neovim.',
      'Bob uses Neovim.'
    ]);

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      subject: 'Bob',
      predicate: 'uses',
      object: 'Neovim'
    });
  });
});
