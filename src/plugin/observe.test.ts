import { describe, expect, it } from 'vitest';
import {
  isObservable, extractObservations, processMessageForObservations,
  detectCategory, extractSearchTerms,
} from './observe.js';

describe('isObservable', () => {
  it('rejects short text', () => {
    expect(isObservable('hi')).toBe(false);
    expect(isObservable('hello world')).toBe(false);
  });

  it('rejects very long text', () => {
    expect(isObservable('x'.repeat(5001))).toBe(false);
  });

  it('accepts meaningful conversation text', () => {
    expect(isObservable('I really prefer using dark mode when coding in the evening.')).toBe(true);
  });

  it('rejects system messages', () => {
    expect(isObservable('[System] Agent heartbeat check in progress now')).toBe(false);
    expect(isObservable('HEARTBEAT ping from the server monitoring system')).toBe(false);
  });
});

describe('extractObservations', () => {
  it('extracts preference observations', () => {
    const obs = extractObservations('I prefer TypeScript over JavaScript for backend development.');
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].category).toBe('preference');
    expect(obs[0].tags).toContain('positive');
  });

  it('extracts decision observations', () => {
    const obs = extractObservations('We decided to use PostgreSQL for the new database.');
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].primitiveType).toBe('decision');
  });

  it('extracts contact info observations', () => {
    const obs = extractObservations('His email is john@example.com and he works at Google.');
    expect(obs.length).toBeGreaterThan(0);
    expect(obs.some(o => o.primitiveType === 'person')).toBe(true);
  });

  it('extracts explicit memory requests', () => {
    const obs = extractObservations('Remember that I am allergic to shellfish please.');
    expect(obs.length).toBeGreaterThan(0);
  });

  it('extracts deadline-related observations', () => {
    const obs = extractObservations('The project deadline is by tomorrow and we need to ship by tonight.');
    expect(obs.length).toBeGreaterThan(0);
    expect(obs.some(o => o.tags.includes('time-sensitive'))).toBe(true);
  });

  it('skips very short sentences', () => {
    const obs = extractObservations('Yes. No. Ok.');
    expect(obs).toHaveLength(0);
  });

  it('includes extractedAt timestamp', () => {
    const obs = extractObservations('I prefer dark mode for all my applications.');
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].extractedAt).toBeInstanceOf(Date);
  });
});

describe('processMessageForObservations', () => {
  it('returns empty for non-observable content', () => {
    const result = processMessageForObservations('hi');
    expect(result.observations).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.reason).toBe('Content not observable');
  });

  it('limits observations to 5', () => {
    const text = Array(10).fill('I prefer dark mode. I like TypeScript. I hate bugs. I need coffee. I want pizza. I love coding.').join(' ');
    const result = processMessageForObservations(text);
    expect(result.observations.length).toBeLessThanOrEqual(5);
  });

  it('processes valid content', () => {
    const result = processMessageForObservations(
      'I prefer using Vim for editing and I always use dark mode. We decided to switch to Rust.'
    );
    expect(result.observations.length).toBeGreaterThan(0);
  });
});

describe('detectCategory', () => {
  it('detects preference category', () => {
    expect(detectCategory('I prefer dark mode')).toBe('preference');
  });

  it('detects decision category', () => {
    expect(detectCategory('We decided to use PostgreSQL')).toBe('decision');
  });

  it('detects task category', () => {
    expect(detectCategory('This task needs to be done by the deadline tomorrow')).toBe('task');
  });

  it('detects entity category', () => {
    expect(detectCategory('John works at Google and his email is john@google.com')).toBe('entity');
  });
});

describe('extractSearchTerms', () => {
  it('removes noise words', () => {
    const result = extractSearchTerms('hey, can you tell me about the database architecture');
    expect(result).not.toContain('hey');
    expect(result).not.toContain('can you');
    expect(result).toContain('database');
    expect(result).toContain('architecture');
  });

  it('preserves meaningful terms', () => {
    const result = extractSearchTerms('PostgreSQL migration strategy');
    expect(result).toContain('PostgreSQL');
    expect(result).toContain('migration');
    expect(result).toContain('strategy');
  });

  it('falls back to original for very short cleaned text', () => {
    const result = extractSearchTerms('hey hello');
    expect(result.length).toBeGreaterThan(0);
  });
});
