/**
 * vault_preferences tool for OpenClaw
 * 
 * Retrieves extracted user preferences from the memory system
 */

import type { ToolSchema, Preference } from '../types.js';
import type { MemoryProvider } from '../provider/index.js';

export const vaultPreferencesSchema: ToolSchema = {
  name: 'vault_preferences',
  description: 'Get user preferences that have been extracted and stored in memory. Useful for personalizing responses.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter preferences by category (e.g., "food", "technology", "entertainment")',
      },
      sentiment: {
        type: 'string',
        description: 'Filter by sentiment',
        enum: ['positive', 'negative', 'neutral'],
      },
      minConfidence: {
        type: 'number',
        description: 'Minimum confidence threshold (0-1)',
        default: 0.5,
      },
    },
    required: [],
  },
};

export interface VaultPreferencesInput {
  category?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  minConfidence?: number;
}

export interface VaultPreferencesOutput {
  preferences: Array<{
    category: string;
    item: string;
    sentiment: 'positive' | 'negative' | 'neutral';
    confidence: number;
  }>;
  totalCount: number;
}

export function createVaultPreferencesHandler(provider: MemoryProvider) {
  return async function vaultPreferencesHandler(input: VaultPreferencesInput): Promise<VaultPreferencesOutput> {
    const allPreferences = await provider.getPreferences();
    const minConfidence = input.minConfidence ?? 0.5;

    const filtered = allPreferences.filter(pref => {
      if (pref.confidence < minConfidence) return false;
      if (input.category && pref.category !== input.category) return false;
      if (input.sentiment && pref.sentiment !== input.sentiment) return false;
      return true;
    });

    return {
      preferences: filtered.map(p => ({
        category: p.category,
        item: p.item,
        sentiment: p.sentiment,
        confidence: p.confidence,
      })),
      totalCount: filtered.length,
    };
  };
}
