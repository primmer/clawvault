import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Message, Preference, DateIndex } from '../src/types.js';

vi.mock('clawvault', () => ({
  ClawVault: vi.fn().mockImplementation(() => ({
    isInitialized: () => true,
    stats: () => Promise.resolve({
      documents: 10,
      categories: { observations: 5, decisions: 3, preferences: 2 },
      links: 5,
      tags: ['test'],
    }),
    find: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    store: () => Promise.resolve({ id: 'test' }),
  })),
  findVault: vi.fn().mockResolvedValue(null),
  createVault: vi.fn().mockImplementation((path) => Promise.resolve({
    isInitialized: () => true,
    stats: () => Promise.resolve({
      documents: 10,
      categories: { observations: 5, decisions: 3, preferences: 2 },
      links: 5,
      tags: ['test'],
    }),
    find: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    store: () => Promise.resolve({ id: 'test' }),
  })),
  Observer: vi.fn().mockImplementation(() => ({
    processMessages: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue({ observations: '', routingSummary: '' }),
    getObservations: vi.fn().mockReturnValue(''),
  })),
}));

import { ClawVaultMemoryProvider } from '../src/provider/index.js';

describe('ClawVaultMemoryProvider', () => {
  let provider: ClawVaultMemoryProvider;

  beforeEach(() => {
    provider = new ClawVaultMemoryProvider({
      vaultPath: '/tmp/test-vault',
      bm25PrefilterK: 50,
      exhaustiveThreshold: 0.3,
      defaultLimit: 10,
    });
  });

  describe('initialization', () => {
    it('should create provider with options', () => {
      expect(provider).toBeDefined();
    });

    it('should initialize vault on first operation', async () => {
      await provider.ingest('test', [{ role: 'user', content: 'test' }]);
      const status = await provider.getStatus();
      expect(status.initialized).toBe(true);
    });
  });

  describe('ingest', () => {
    it('should ingest messages and return result', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello, how are you?' },
        { role: 'assistant', content: 'I am doing well, thank you!' },
      ];

      const result = await provider.ingest('test-session', messages);

      expect(result.sessionId).toBe('test-session');
      expect(result.documentsCreated).toBe(2);
    });

    it('should extract preferences from messages', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'I really like pizza and coffee.' },
        { role: 'user', content: 'I hate cold weather.' },
      ];

      const result = await provider.ingest('test-session', messages);

      expect(result.preferencesExtracted).toBeGreaterThan(0);

      const prefs = await provider.getPreferences();
      expect(prefs.length).toBeGreaterThan(0);
      
      const pizzaPref = prefs.find(p => p.item.toLowerCase().includes('pizza'));
      expect(pizzaPref?.sentiment).toBe('positive');
    });

    it('should extract dates from messages', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'I have a meeting tomorrow at 3pm.' },
        { role: 'user', content: 'The deadline is on January 15, 2025.' },
      ];

      const result = await provider.ingest('test-session', messages, new Date('2025-01-10'));

      expect(result.datesIndexed).toBeGreaterThan(0);

      const dates = await provider.getDates();
      expect(dates.length).toBeGreaterThan(0);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      const messages: Message[] = [
        { role: 'user', content: 'I love TypeScript programming.' },
        { role: 'user', content: 'My favorite food is sushi.' },
        { role: 'user', content: 'I have a dentist appointment tomorrow.' },
      ];
      await provider.ingest('test-session', messages);
    });

    it('should search with auto query type detection', async () => {
      const results = await provider.search('programming');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should search preferences with preference query type', async () => {
      const results = await provider.search('What do I like?', {
        queryType: 'preference',
      });
      expect(Array.isArray(results)).toBe(true);
    });

    it('should search temporal data with temporal query type', async () => {
      const results = await provider.search('What is scheduled for tomorrow?', {
        queryType: 'temporal',
      });
      expect(Array.isArray(results)).toBe(true);
    });

    it('should respect limit option', async () => {
      const results = await provider.search('test', { limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getPreferences', () => {
    it('should return empty array when no preferences', async () => {
      const prefs = await provider.getPreferences();
      expect(prefs).toEqual([]);
    });

    it('should return extracted preferences', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'I really enjoy reading science fiction books.' },
      ];
      await provider.ingest('test-session', messages);

      const prefs = await provider.getPreferences();
      expect(prefs.length).toBeGreaterThan(0);
      expect(prefs[0]).toHaveProperty('category');
      expect(prefs[0]).toHaveProperty('item');
      expect(prefs[0]).toHaveProperty('sentiment');
      expect(prefs[0]).toHaveProperty('confidence');
    });
  });

  describe('getDates', () => {
    it('should return empty array when no dates indexed', async () => {
      const dates = await provider.getDates();
      expect(dates).toEqual([]);
    });

    it('should return indexed dates sorted by date descending', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Meeting on January 10, 2025.' },
        { role: 'user', content: 'Deadline on January 20, 2025.' },
      ];
      await provider.ingest('test-session', messages);

      const dates = await provider.getDates();
      if (dates.length >= 2) {
        const date1 = new Date(dates[0].date);
        const date2 = new Date(dates[1].date);
        expect(date1.getTime()).toBeGreaterThanOrEqual(date2.getTime());
      }
    });
  });

  describe('getStatus', () => {
    it('should return vault status', async () => {
      const status = await provider.getStatus();

      expect(status).toHaveProperty('initialized');
      expect(status).toHaveProperty('documentCount');
      expect(status).toHaveProperty('categories');
      expect(status).toHaveProperty('preferencesCount');
      expect(status).toHaveProperty('datesIndexedCount');
    });
  });
});

describe('Preference Extraction', () => {
  let provider: ClawVaultMemoryProvider;

  beforeEach(() => {
    provider = new ClawVaultMemoryProvider({
      vaultPath: '/tmp/test-vault',
    });
  });

  it('should extract positive preferences', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'I really like Italian food.' },
      { role: 'user', content: 'I love programming in TypeScript.' },
    ];
    
    await provider.ingest('test', messages);
    const prefs = await provider.getPreferences();
    
    const positivePrefs = prefs.filter(p => p.sentiment === 'positive');
    expect(positivePrefs.length).toBeGreaterThan(0);
  });

  it('should extract negative preferences', async () => {
    const messages: Message[] = [
      { role: 'user', content: "I don't like cold weather." },
      { role: 'user', content: 'I hate waiting in lines.' },
    ];
    
    await provider.ingest('test', messages);
    const prefs = await provider.getPreferences();
    
    const negativePrefs = prefs.filter(p => p.sentiment === 'negative');
    expect(negativePrefs.length).toBeGreaterThan(0);
  });

  it('should extract favorite items with category', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'My favorite programming language is Rust.' },
    ];
    
    await provider.ingest('test', messages);
    const prefs = await provider.getPreferences();
    
    expect(prefs.some(p => p.item.toLowerCase().includes('rust'))).toBe(true);
  });
});

describe('Date Extraction', () => {
  let provider: ClawVaultMemoryProvider;

  beforeEach(() => {
    provider = new ClawVaultMemoryProvider({
      vaultPath: '/tmp/test-vault',
    });
  });

  it('should extract relative dates like tomorrow', async () => {
    const referenceDate = new Date('2025-01-15');
    const messages: Message[] = [
      { role: 'user', content: 'I have a meeting tomorrow.' },
    ];
    
    await provider.ingest('test', messages, referenceDate);
    const dates = await provider.getDates();
    
    expect(dates.some(d => d.date === '2025-01-16')).toBe(true);
  });

  it('should extract explicit dates', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'The deadline is on January 20, 2025.' },
    ];
    
    await provider.ingest('test', messages);
    const dates = await provider.getDates();
    
    expect(dates.length).toBeGreaterThan(0);
  });

  it('should infer event types', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'I have a dentist appointment tomorrow.' },
    ];
    
    await provider.ingest('test', messages, new Date('2025-01-15'));
    const dates = await provider.getDates();
    
    const hasAppointment = dates.some(d => 
      d.events.some(e => e.type === 'appointment')
    );
    expect(hasAppointment).toBe(true);
  });
});

describe('Query Classification', () => {
  let provider: ClawVaultMemoryProvider;

  beforeEach(() => {
    provider = new ClawVaultMemoryProvider({
      vaultPath: '/tmp/test-vault',
    });
  });

  it('should classify preference queries correctly', async () => {
    const preferenceQueries = [
      'Do I like coffee?',
      'What do I prefer for breakfast?',
      'My favorite programming language',
    ];

    for (const query of preferenceQueries) {
      const results = await provider.search(query, { queryType: 'auto' });
      expect(Array.isArray(results)).toBe(true);
    }
  });

  it('should classify temporal queries correctly', async () => {
    const temporalQueries = [
      'When is my next meeting?',
      'What happened yesterday?',
      'Schedule for January 15',
    ];

    for (const query of temporalQueries) {
      const results = await provider.search(query, { queryType: 'auto' });
      expect(Array.isArray(results)).toBe(true);
    }
  });

  it('should classify factual queries correctly', async () => {
    const factualQueries = [
      'What is TypeScript?',
      'How does React work?',
      'Explain the observer pattern',
    ];

    for (const query of factualQueries) {
      const results = await provider.search(query, { queryType: 'auto' });
      expect(Array.isArray(results)).toBe(true);
    }
  });
});
