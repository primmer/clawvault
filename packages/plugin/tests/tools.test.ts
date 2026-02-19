import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMemorySearchHandler, memorySearchSchema } from '../src/tools/memory-search.js';
import { createVaultStatusHandler, vaultStatusSchema } from '../src/tools/vault-status.js';
import { createVaultPreferencesHandler, vaultPreferencesSchema } from '../src/tools/vault-preferences.js';
import type { MemoryProvider } from '../src/provider/index.js';

function createMockProvider(): MemoryProvider {
  return {
    ingest: vi.fn().mockResolvedValue({
      documentsCreated: 2,
      preferencesExtracted: 1,
      datesIndexed: 1,
      sessionId: 'test',
    }),
    search: vi.fn().mockResolvedValue([
      {
        id: 'doc-1',
        title: 'Test Document',
        content: 'Test content',
        snippet: 'Test snippet',
        score: 0.85,
        category: 'observations',
      },
    ]),
    getPreferences: vi.fn().mockResolvedValue([
      {
        category: 'food',
        item: 'pizza',
        sentiment: 'positive',
        confidence: 0.9,
        extractedAt: new Date(),
      },
    ]),
    getDates: vi.fn().mockResolvedValue([
      {
        date: '2025-01-15',
        documents: ['doc-1'],
        events: [{ title: 'Meeting', documentId: 'doc-1', type: 'meeting' }],
      },
    ]),
    getStatus: vi.fn().mockResolvedValue({
      initialized: true,
      documentCount: 100,
      categories: { observations: 50, decisions: 30, preferences: 20 },
      preferencesCount: 15,
      datesIndexedCount: 10,
      lastActivity: new Date(),
    }),
  };
}

describe('memory_search tool', () => {
  let mockProvider: MemoryProvider;
  let handler: ReturnType<typeof createMemorySearchHandler>;

  beforeEach(() => {
    mockProvider = createMockProvider();
    handler = createMemorySearchHandler(mockProvider);
  });

  it('should have correct schema', () => {
    expect(memorySearchSchema.name).toBe('memory_search');
    expect(memorySearchSchema.parameters.properties.query).toBeDefined();
    expect(memorySearchSchema.parameters.required).toContain('query');
  });

  it('should call provider.search with query', async () => {
    const result = await handler({ query: 'test query' });

    expect(mockProvider.search).toHaveBeenCalledWith('test query', expect.any(Object));
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe('Test Document');
  });

  it('should pass options to provider', async () => {
    await handler({
      query: 'test',
      limit: 5,
      category: 'decisions',
      queryType: 'factual',
      threshold: 0.5,
    });

    expect(mockProvider.search).toHaveBeenCalledWith('test', {
      limit: 5,
      category: 'decisions',
      queryType: 'factual',
      threshold: 0.5,
    });
  });

  it('should return formatted results', async () => {
    const result = await handler({ query: 'test' });

    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('queryType');
    expect(result).toHaveProperty('totalResults');
    expect(result.totalResults).toBe(1);
  });
});

describe('vault_status tool', () => {
  let mockProvider: MemoryProvider;
  let handler: ReturnType<typeof createVaultStatusHandler>;

  beforeEach(() => {
    mockProvider = createMockProvider();
    handler = createVaultStatusHandler(mockProvider);
  });

  it('should have correct schema', () => {
    expect(vaultStatusSchema.name).toBe('vault_status');
    expect(vaultStatusSchema.parameters.properties.includeCategories).toBeDefined();
  });

  it('should return vault status', async () => {
    const result = await handler({});

    expect(mockProvider.getStatus).toHaveBeenCalled();
    expect(result.initialized).toBe(true);
    expect(result.documentCount).toBe(100);
    expect(result.preferencesCount).toBe(15);
  });

  it('should include categories by default', async () => {
    const result = await handler({});

    expect(result.categories).toBeDefined();
    expect(result.categories?.observations).toBe(50);
  });

  it('should exclude categories when includeCategories is false', async () => {
    const result = await handler({ includeCategories: false });

    expect(result.categories).toBeUndefined();
  });
});

describe('vault_preferences tool', () => {
  let mockProvider: MemoryProvider;
  let handler: ReturnType<typeof createVaultPreferencesHandler>;

  beforeEach(() => {
    mockProvider = createMockProvider();
    handler = createVaultPreferencesHandler(mockProvider);
  });

  it('should have correct schema', () => {
    expect(vaultPreferencesSchema.name).toBe('vault_preferences');
    expect(vaultPreferencesSchema.parameters.properties.category).toBeDefined();
    expect(vaultPreferencesSchema.parameters.properties.sentiment).toBeDefined();
  });

  it('should return preferences', async () => {
    const result = await handler({});

    expect(mockProvider.getPreferences).toHaveBeenCalled();
    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0].item).toBe('pizza');
  });

  it('should filter by category', async () => {
    (mockProvider.getPreferences as ReturnType<typeof vi.fn>).mockResolvedValue([
      { category: 'food', item: 'pizza', sentiment: 'positive', confidence: 0.9, extractedAt: new Date() },
      { category: 'tech', item: 'typescript', sentiment: 'positive', confidence: 0.8, extractedAt: new Date() },
    ]);

    const result = await handler({ category: 'food' });

    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0].category).toBe('food');
  });

  it('should filter by sentiment', async () => {
    (mockProvider.getPreferences as ReturnType<typeof vi.fn>).mockResolvedValue([
      { category: 'food', item: 'pizza', sentiment: 'positive', confidence: 0.9, extractedAt: new Date() },
      { category: 'food', item: 'broccoli', sentiment: 'negative', confidence: 0.7, extractedAt: new Date() },
    ]);

    const result = await handler({ sentiment: 'negative' });

    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0].sentiment).toBe('negative');
  });

  it('should filter by minimum confidence', async () => {
    (mockProvider.getPreferences as ReturnType<typeof vi.fn>).mockResolvedValue([
      { category: 'food', item: 'pizza', sentiment: 'positive', confidence: 0.9, extractedAt: new Date() },
      { category: 'food', item: 'pasta', sentiment: 'positive', confidence: 0.4, extractedAt: new Date() },
    ]);

    const result = await handler({ minConfidence: 0.5 });

    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0].confidence).toBeGreaterThanOrEqual(0.5);
  });
});
