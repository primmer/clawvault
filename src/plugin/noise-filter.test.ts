import { describe, expect, it } from 'vitest';
import { isNoise, filterNoise, DEFAULT_NOISE_CONFIG } from './noise-filter.js';

describe('isNoise', () => {
  it('rejects empty text', () => {
    expect(isNoise('', DEFAULT_NOISE_CONFIG).isNoise).toBe(true);
    expect(isNoise('', DEFAULT_NOISE_CONFIG).category).toBe('length');
  });

  it('rejects text shorter than minLength', () => {
    const result = isNoise('hi there', DEFAULT_NOISE_CONFIG);
    expect(result.isNoise).toBe(true);
    expect(result.category).toBe('length');
  });

  it('rejects text longer than maxLength', () => {
    const longText = 'a'.repeat(5001);
    const result = isNoise(longText, DEFAULT_NOISE_CONFIG);
    expect(result.isNoise).toBe(true);
    expect(result.category).toBe('length');
  });

  it('rejects greetings', () => {
    // Only exact greeting patterns (no extra words)
    const greetings = ['Hello!', 'Hey!', 'Good morning!', 'Thanks!', 'Ok!', 'Sure!'];
    for (const g of greetings) {
      expect(isNoise(g, { ...DEFAULT_NOISE_CONFIG, minLength: 1 }).isNoise).toBe(true);
    }
  });

  it('rejects system noise', () => {
    expect(isNoise('[System update required]', DEFAULT_NOISE_CONFIG).isNoise).toBe(true);
    expect(isNoise('HEARTBEAT ping 1234', DEFAULT_NOISE_CONFIG).isNoise).toBe(true);
    expect(isNoise('NO_REPLY expected', DEFAULT_NOISE_CONFIG).isNoise).toBe(true);
  });

  it('rejects refusals', () => {
    const result = isNoise("I can't help with that kind of request.", DEFAULT_NOISE_CONFIG);
    expect(result.isNoise).toBe(true);
    expect(result.category).toBe('refusal');
  });

  it('rejects meta-questions', () => {
    const result = isNoise('How does it feel to be an AI assistant?', DEFAULT_NOISE_CONFIG);
    expect(result.isNoise).toBe(true);
    expect(result.category).toBe('meta');
  });

  it('rejects low-info content', () => {
    expect(isNoise('yes', { ...DEFAULT_NOISE_CONFIG, minLength: 1 }).isNoise).toBe(true);
    expect(isNoise('lol', { ...DEFAULT_NOISE_CONFIG, minLength: 1 }).isNoise).toBe(true);
  });

  it('rejects high markdown density', () => {
    const result = isNoise('## Header\n\n- item\n- item\n```code```\n| col | col |', DEFAULT_NOISE_CONFIG);
    expect(result.isNoise).toBe(true);
  });

  it('accepts meaningful content', () => {
    expect(isNoise('I prefer using TypeScript for all my projects.', DEFAULT_NOISE_CONFIG).isNoise).toBe(false);
    expect(isNoise('We decided to use PostgreSQL for the new backend service.', DEFAULT_NOISE_CONFIG).isNoise).toBe(false);
    expect(isNoise('Pedro lives in San Francisco and works at Google.', DEFAULT_NOISE_CONFIG).isNoise).toBe(false);
  });

  it('respects disabled config', () => {
    const result = isNoise('hi', { ...DEFAULT_NOISE_CONFIG, enabled: false });
    expect(result.isNoise).toBe(false);
  });

  it('rejects JSON tool calls', () => {
    const json = '{"type": "tool_use", "name": "memory_search", "input": {"query": "test"}}';
    const result = isNoise(json, DEFAULT_NOISE_CONFIG);
    expect(result.isNoise).toBe(true);
    expect(result.category).toBe('system');
  });
});

describe('filterNoise', () => {
  it('filters noise items from array', () => {
    const items = [
      { text: 'I prefer dark mode for coding.' },
      { text: 'Ok!' },
      { text: 'We decided to use React for the frontend.' },
      { text: 'Hi!' },
    ];
    const filtered = filterNoise(items, { ...DEFAULT_NOISE_CONFIG, minLength: 1 });
    expect(filtered).toHaveLength(2);
    expect(filtered[0].text).toContain('dark mode');
    expect(filtered[1].text).toContain('React');
  });

  it('works with content field', () => {
    const items = [
      { content: 'The meeting is scheduled for next Tuesday at 3pm.' },
      { content: 'yes' },
    ];
    const filtered = filterNoise(items, { ...DEFAULT_NOISE_CONFIG, minLength: 1 });
    expect(filtered).toHaveLength(1);
  });
});
