import { afterEach, describe, expect, it } from 'vitest';
import { Compressor } from './compressor.js';

const originalAnthropic = process.env.ANTHROPIC_API_KEY;
const originalOpenAI = process.env.OPENAI_API_KEY;
const originalGemini = process.env.GEMINI_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = originalAnthropic;
  process.env.OPENAI_API_KEY = originalOpenAI;
  process.env.GEMINI_API_KEY = originalGemini;
});

describe('Compressor', () => {
  it('deduplicates by normalized content during merges', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.OPENAI_API_KEY = 'test-key';

    const fetchImpl: typeof fetch = async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '## 2026-02-11\n\n🟢 10:30 Team aligned on migration plan\n🟢 10:35 Added rollback test'
              }
            }
          ]
        })
      } as Response;
    };

    const compressor = new Compressor({
      now: () => new Date('2026-02-11T10:30:00.000Z'),
      fetchImpl
    });

    const existing = '## 2026-02-11\n\n🟡 10:00 Team aligned on migration plan';
    const merged = await compressor.compress(['merge updates'], existing);

    expect((merged.match(/Team aligned on migration plan/g) ?? []).length).toBe(1);
    expect(merged).toContain('Added rollback test');
  });

  it('marks explicit decision markers as critical', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';

    const compressor = new Compressor({
      now: () => new Date('2026-02-11T12:00:00.000Z')
    });
    const output = await compressor.compress(
      [
        'Decision: move auth to service boundary',
        'Decided: keep retries at 3',
        'Chose: PostgreSQL',
        'Selected: circuit breaker library'
      ],
      ''
    );

    expect(output).toMatch(/🔴\s+\d{2}:\d{2}\s+Decision: move auth to service boundary/);
    expect(output).toMatch(/🔴\s+\d{2}:\d{2}\s+Decided: keep retries at 3/);
    expect(output).toMatch(/🔴\s+\d{2}:\d{2}\s+Chose: PostgreSQL/);
    expect(output).toMatch(/🔴\s+\d{2}:\d{2}\s+Selected: circuit breaker library/);
  });

  it('treats preferences and routine deadlines as notable, dated deadlines as critical', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.GEMINI_API_KEY = '';

    const compressor = new Compressor({
      now: () => new Date('2026-02-11T12:00:00.000Z')
    });
    const output = await compressor.compress(
      [
        'User preference: keep npm scripts as entrypoint',
        'Routine deadline next sprint for docs refresh',
        'Release deadline is 2026-02-28 for migration cutover'
      ],
      ''
    );

    expect(output).toMatch(/🟡\s+\d{2}:\d{2}\s+User preference: keep npm scripts as entrypoint/);
    expect(output).toMatch(/🟡\s+\d{2}:\d{2}\s+Routine deadline next sprint for docs refresh/);
    expect(output).toMatch(/🔴\s+\d{2}:\d{2}\s+Release deadline is 2026-02-28 for migration cutover/);
  });
});
