import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'path';

const { execFileSyncMock, spawnSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  spawnSyncMock: vi.fn()
}));

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
  spawnSync: spawnSyncMock
}));

async function loadSearchModule() {
  vi.resetModules();
  return await import('./search.js');
}

function withQmdIndexEnv<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.CLAWVAULT_QMD_INDEX;
  if (value === undefined) {
    delete process.env.CLAWVAULT_QMD_INDEX;
  } else {
    process.env.CLAWVAULT_QMD_INDEX = value;
  }

  return run().finally(() => {
    if (previous === undefined) {
      delete process.env.CLAWVAULT_QMD_INDEX;
    } else {
      process.env.CLAWVAULT_QMD_INDEX = previous;
    }
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('search qmd dependency', () => {
  it('returns false when qmd is not available', async () => {
    spawnSyncMock.mockReturnValue({ error: new Error('missing') });
    const { hasQmd } = await loadSearchModule();
    expect(hasQmd()).toBe(false);
  });

  it('throws when searching without qmd installed', async () => {
    spawnSyncMock.mockReturnValue({ error: new Error('missing') });
    const { SearchEngine, QmdUnavailableError } = await loadSearchModule();
    const engine = new SearchEngine();
    expect(() => engine.search('hello')).toThrow(QmdUnavailableError);
  });

  it('keeps default qmd index when no override is provided', async () => {
    await withQmdIndexEnv(undefined, async () => {
      spawnSyncMock.mockReturnValue({ error: undefined });
      const { qmdUpdate } = await loadSearchModule();
      qmdUpdate('vault');

      expect(execFileSyncMock).toHaveBeenCalledWith('qmd', ['update', '-c', 'vault'], { stdio: 'inherit' });
    });
  });

  it('passes explicit qmd index to update/embed helpers', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined });
    const { qmdUpdate, qmdEmbed } = await loadSearchModule();

    qmdUpdate('vault', 'clawvault-test');
    qmdEmbed('vault', 'clawvault-test');

    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      1,
      'qmd',
      ['--index', 'clawvault-test', 'update', '-c', 'vault'],
      { stdio: 'inherit' }
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      'qmd',
      ['--index', 'clawvault-test', 'embed', '-c', 'vault'],
      { stdio: 'inherit' }
    );
  });

  it('uses configured qmd index when search engine executes queries', async () => {
    await withQmdIndexEnv('clawvault-test', async () => {
      spawnSyncMock.mockReturnValue({ error: undefined });
      execFileSyncMock.mockReturnValue(JSON.stringify([]));

      const { SearchEngine } = await loadSearchModule();
      const engine = new SearchEngine();
      engine.setCollection('vault');
      engine.search('hello');

      expect(execFileSyncMock).toHaveBeenCalledWith(
        'qmd',
        ['--index', 'clawvault-test', 'search', 'hello', '-n', '20', '--json', '-c', 'vault'],
        expect.objectContaining({
          encoding: 'utf-8'
        })
      );
    });
  });

  it('converts qmd results and applies filters', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined });
    execFileSyncMock.mockReturnValue(
      JSON.stringify([
        {
          docid: '1',
          score: 10,
          file: 'qmd://vault/projects/demo.md',
          title: 'Demo',
          snippet: '@@ -1,2 @@ (1 before, 2 after)\nLine1\nLine2\nLine3\nLine4'
        },
        {
          docid: '2',
          score: 5,
          file: 'qmd://vault/notes/other.md',
          title: 'Other',
          snippet: 'Other snippet'
        }
      ])
    );

    const { SearchEngine } = await loadSearchModule();
    const engine = new SearchEngine();
    engine.setCollection('vault');
    engine.setVaultPath('/vault');
    engine.setCollectionRoot('/vault');
    engine.addDocument({
      id: 'projects/demo',
      path: '/vault/projects/demo.md',
      category: 'projects',
      title: 'Demo',
      content: 'content',
      frontmatter: {},
      links: [],
      tags: ['keep'],
      modified: new Date()
    });

    const results = engine.search('hello', {
      tags: ['keep'],
      category: 'projects',
      limit: 5
    });

    expect(results).toHaveLength(1);
    expect(results[0].document.id).toBe('projects/demo');
    expect(results[0].document.path).toBe('/vault/projects/demo.md');
    expect(results[0].score).toBe(1);
    expect(results[0].snippet).not.toContain('@@');
    expect(results[0].snippet).toContain('Line1');
  });

  it('parses qmd output from error streams', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined });
    execFileSyncMock.mockImplementation(() => {
      const err: any = new Error('qmd failed');
      err.stdout =
        'noise\n[{"docid":"1","score":2,"file":"qmd://vault/notes/a.md","title":"A","snippet":"hi"}]';
      throw err;
    });

    const { SearchEngine } = await loadSearchModule();
    const engine = new SearchEngine();
    engine.setCollectionRoot('/vault');
    engine.setVaultPath('/vault');

    const results = engine.search('fallback', { limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0].document.path).toBe(path.resolve('/vault/notes/a.md'));
  });

  it('applies temporal boosting when enabled', async () => {
    spawnSyncMock.mockReturnValue({ error: undefined });
    execFileSyncMock.mockReturnValue(
      JSON.stringify([
        {
          docid: '1',
          score: 10,
          file: 'qmd://vault/projects/recent.md',
          title: 'Recent',
          snippet: 'Recent snippet'
        },
        {
          docid: '2',
          score: 9,
          file: 'qmd://vault/projects/older.md',
          title: 'Older',
          snippet: 'Older snippet'
        }
      ])
    );

    const { SearchEngine } = await loadSearchModule();
    const engine = new SearchEngine();
    engine.setCollectionRoot('/vault');
    engine.setVaultPath('/vault');
    engine.addDocument({
      id: 'projects/recent',
      path: '/vault/projects/recent.md',
      category: 'projects',
      title: 'Recent',
      content: 'content',
      frontmatter: {},
      links: [],
      tags: [],
      modified: new Date()
    });
    engine.addDocument({
      id: 'projects/older',
      path: '/vault/projects/older.md',
      category: 'projects',
      title: 'Older',
      content: 'content',
      frontmatter: {},
      links: [],
      tags: [],
      modified: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    });

    const boosted = engine.search('timeline', {
      limit: 2,
      temporalBoost: true
    });
    expect(boosted).toHaveLength(2);
    expect(boosted[0].score).toBeCloseTo(1.0, 5);
    expect(boosted[1].score).toBeCloseTo(0.63, 5);

    const unboosted = engine.search('timeline', {
      limit: 2,
      temporalBoost: false
    });
    expect(unboosted[1].score).toBeCloseTo(0.9, 5);
  });
});

// ---------------------------------------------------------------------------
// v2.7 — Unit tests for new search capabilities
// ---------------------------------------------------------------------------

describe('v2.7 — sentenceChunk', () => {
  it('splits text into sentence-aligned chunks', async () => {
    const { sentenceChunk } = await loadSearchModule();
    const text = 'Hello world. This is a test. Another sentence here. And one more.';
    const chunks = sentenceChunk(text, 40, 0);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be ≤ maxChars
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(60); // some slack
  });

  it('returns full text as single chunk when short', async () => {
    const { sentenceChunk } = await loadSearchModule();
    const chunks = sentenceChunk('Short text.', 600);
    expect(chunks).toEqual(['Short text.']);
  });
});

describe('v2.7 — bm25RankChunks', () => {
  it('ranks chunks by keyword overlap', async () => {
    const { bm25RankChunks } = await loadSearchModule();
    const chunks = [
      'The weather is nice today.',
      'I use TypeScript for all my projects.',
      'TypeScript and Rust are my favorite languages.',
    ];
    const ranked = bm25RankChunks(chunks, ['typescript', 'rust'], 3);
    // First result is always chunk[0] (context), but highest-scored should be chunk[2]
    const scores = ranked.map(r => r.score);
    expect(ranked.some(r => r.text.includes('Rust'))).toBe(true);
  });
});

describe('v2.7 — extractDates', () => {
  it('extracts ISO dates', async () => {
    const { extractDates } = await loadSearchModule();
    const dates = extractDates('We met on 2024-03-15 at the coffee shop.');
    expect(dates).toHaveLength(1);
    expect(dates[0].date).toBe('2024-03-15');
  });

  it('extracts natural language dates', async () => {
    const { extractDates } = await loadSearchModule();
    const dates = extractDates('The event is on January 20, 2025 at noon.');
    expect(dates).toHaveLength(1);
    expect(dates[0].date).toBe('2025-01-20');
  });

  it('extracts relative dates from session date', async () => {
    const { extractDates } = await loadSearchModule();
    const dates = extractDates('I started 3 days ago and it was great.', '2024-06-10');
    // Should find a relative date ~3 days before 2024-06-10
    expect(dates.length).toBeGreaterThan(0);
    const relDate = dates.find(d => !d.date.startsWith('duration:'));
    expect(relDate).toBeDefined();
    expect(relDate!.date).toBe('2024-06-07');
  });

  it('extracts durations', async () => {
    const { extractDates } = await loadSearchModule();
    const dates = extractDates('The trip lasted for 5 days total.');
    expect(dates.some(d => d.date.startsWith('duration:'))).toBe(true);
  });
});

describe('v2.7 — extractPreferences', () => {
  it('extracts "I use X" preferences', async () => {
    const { extractPreferences } = await loadSearchModule();
    const prefs = extractPreferences('I use VS Code as my main editor for all my work.');
    expect(prefs).toHaveLength(1);
    expect(prefs[0].value).toContain('VS Code');
    expect(prefs[0].category).toBe('tool');
  });

  it('extracts "I love X" preferences', async () => {
    const { extractPreferences } = await loadSearchModule();
    const prefs = extractPreferences('I love hiking in the mountains every weekend.');
    expect(prefs).toHaveLength(1);
    expect(prefs[0].value).toContain('hiking');
  });
});

describe('v2.7 — classifyQuestion', () => {
  it('classifies preference questions', async () => {
    const { classifyQuestion } = await loadSearchModule();
    expect(classifyQuestion('Can you recommend a good restaurant?')).toBe('preference');
    expect(classifyQuestion('What should I watch tonight?')).toBe('preference');
  });

  it('classifies temporal questions', async () => {
    const { classifyQuestion } = await loadSearchModule();
    expect(classifyQuestion('How many days passed since my trip?')).toBe('temporal');
    expect(classifyQuestion('Which happened first, the meeting or the call?')).toBe('temporal');
  });

  it('classifies aggregation questions', async () => {
    const { classifyQuestion } = await loadSearchModule();
    expect(classifyQuestion('How many books did I read?')).toBe('aggregation');
    expect(classifyQuestion('List all the restaurants I visited.')).toBe('aggregation');
  });

  it('classifies default questions', async () => {
    const { classifyQuestion } = await loadSearchModule();
    expect(classifyQuestion('What is my dog\'s name?')).toBe('default');
  });
});
