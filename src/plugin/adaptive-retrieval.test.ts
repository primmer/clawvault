import { describe, expect, it } from 'vitest';
import { shouldRetrieve, DEFAULT_ADAPTIVE_CONFIG } from './adaptive-retrieval.js';

describe('shouldRetrieve', () => {
  it('skips greetings', () => {
    // Short greetings may be caught by too_short — we just check shouldRetrieve is false
    const greetings = ['Hello there!', 'Hi there friend', 'Good morning!'];
    for (const g of greetings) {
      const result = shouldRetrieve(g, DEFAULT_ADAPTIVE_CONFIG);
      expect(result.shouldRetrieve).toBe(false);
    }
  });

  it('skips farewells', () => {
    const farewells = ['Goodbye!', 'Good night!', 'Take care!'];
    for (const f of farewells) {
      const result = shouldRetrieve(f, DEFAULT_ADAPTIVE_CONFIG);
      expect(result.shouldRetrieve).toBe(false);
    }
  });

  it('skips slash commands', () => {
    expect(shouldRetrieve('/help', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(false);
    expect(shouldRetrieve('/status', DEFAULT_ADAPTIVE_CONFIG).skipReason).toBe('slash_command');
    expect(shouldRetrieve('/commit', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(false);
  });

  it('skips confirmations', () => {
    const confirmations = ['Ok', 'Sure', 'Yes', 'No', 'Got it', 'Perfect', 'Great!', 'Cool'];
    for (const c of confirmations) {
      const result = shouldRetrieve(c, DEFAULT_ADAPTIVE_CONFIG);
      expect(result.shouldRetrieve).toBe(false);
    }
  });

  it('skips empty and very short messages', () => {
    expect(shouldRetrieve('', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(false);
    expect(shouldRetrieve('hi', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(false);
    expect(shouldRetrieve('k', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(false);
  });

  it('skips system messages', () => {
    expect(shouldRetrieve('[System update required now]', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(false);
    expect(shouldRetrieve('[HEARTBEAT ping from server]', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(false);
  });

  it('retrieves for meaningful queries', () => {
    expect(shouldRetrieve('What food allergies does the user have?', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(true);
    expect(shouldRetrieve('Tell me about the project architecture decisions', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(true);
    expect(shouldRetrieve('When did we decide to use PostgreSQL?', DEFAULT_ADAPTIVE_CONFIG).shouldRetrieve).toBe(true);
  });

  it('respects disabled config', () => {
    const result = shouldRetrieve('Hi', { ...DEFAULT_ADAPTIVE_CONFIG, enabled: false });
    expect(result.shouldRetrieve).toBe(true);
  });

  it('supports user-defined skip patterns', () => {
    const config = {
      ...DEFAULT_ADAPTIVE_CONFIG,
      skipPatterns: ['^test\\b', 'ignore this'],
    };
    expect(shouldRetrieve('test something', config).shouldRetrieve).toBe(false);
    expect(shouldRetrieve('please ignore this message', config).shouldRetrieve).toBe(false);
    expect(shouldRetrieve('This is a real question about testing', config).shouldRetrieve).toBe(true);
  });

  it('handles invalid regex patterns gracefully', () => {
    const config = {
      ...DEFAULT_ADAPTIVE_CONFIG,
      skipPatterns: ['[invalid regex'],
    };
    // Should not throw, just skip the bad pattern
    expect(shouldRetrieve('something', config).shouldRetrieve).toBe(true);
  });
});
