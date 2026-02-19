/**
 * vault_status tool for OpenClaw
 * 
 * Returns the current status of the ClawVault memory system
 */

import type { ToolSchema } from '../types.js';
import type { MemoryProvider } from '../provider/index.js';

export const vaultStatusSchema: ToolSchema = {
  name: 'vault_status',
  description: 'Get the current status of the ClawVault memory system including document counts, categories, and indexed data.',
  parameters: {
    type: 'object',
    properties: {
      includeCategories: {
        type: 'boolean',
        description: 'Include detailed category breakdown',
        default: true,
      },
    },
    required: [],
  },
};

export interface VaultStatusInput {
  includeCategories?: boolean;
}

export interface VaultStatusOutput {
  initialized: boolean;
  documentCount: number;
  categories?: Record<string, number>;
  preferencesCount: number;
  datesIndexedCount: number;
  lastActivity?: string;
}

export function createVaultStatusHandler(provider: MemoryProvider) {
  return async function vaultStatusHandler(input: VaultStatusInput): Promise<VaultStatusOutput> {
    const status = await provider.getStatus();

    return {
      initialized: status.initialized,
      documentCount: status.documentCount,
      categories: input.includeCategories !== false ? status.categories : undefined,
      preferencesCount: status.preferencesCount,
      datesIndexedCount: status.datesIndexedCount,
      lastActivity: status.lastActivity?.toISOString(),
    };
  };
}
