/**
 * memory_search tool for OpenClaw
 * 
 * Searches the ClawVault memory with smart query routing
 */

import type { ToolSchema, SearchOptions, QueryType } from '../types.js';
import type { MemoryProvider } from '../provider/index.js';

export const memorySearchSchema: ToolSchema = {
  name: 'memory_search',
  description: 'Search agent memory for relevant information. Automatically routes queries to the appropriate search strategy (factual, preference, temporal, or semantic).',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
        default: 10,
      },
      category: {
        type: 'string',
        description: 'Filter results by category (e.g., "decisions", "observations", "preferences")',
      },
      queryType: {
        type: 'string',
        description: 'Force a specific query type instead of auto-detection',
        enum: ['factual', 'preference', 'temporal', 'semantic', 'auto'],
        default: 'auto',
      },
      threshold: {
        type: 'number',
        description: 'Minimum score threshold for results (0-1)',
        default: 0.3,
      },
    },
    required: ['query'],
  },
};

export interface MemorySearchInput {
  query: string;
  limit?: number;
  category?: string;
  queryType?: QueryType;
  threshold?: number;
}

export interface MemorySearchOutput {
  results: Array<{
    id: string;
    title: string;
    snippet: string;
    score: number;
    category?: string;
  }>;
  queryType: QueryType;
  totalResults: number;
}

export function createMemorySearchHandler(provider: MemoryProvider) {
  return async function memorySearchHandler(input: MemorySearchInput): Promise<MemorySearchOutput> {
    const options: SearchOptions = {
      limit: input.limit,
      category: input.category,
      queryType: input.queryType ?? 'auto',
      threshold: input.threshold,
    };

    const results = await provider.search(input.query, options);

    return {
      results: results.map(r => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet,
        score: r.score,
        category: r.category,
      })),
      queryType: input.queryType ?? 'auto',
      totalResults: results.length,
    };
  };
}
