/**
 * @clawvault/sdk — TypeScript SDK for ClawVault
 * 
 * Structured agent memory with hybrid search, observation, and context management.
 * 
 * @example
 * ```typescript
 * import { ClawVault } from '@clawvault/sdk';
 * 
 * const vault = new ClawVault({ path: '~/clawvault' });
 * const results = vault.search('user preferences');
 * ```
 * 
 * @packageDocumentation
 */

export { ClawVault } from './vault.js';
export { search, searchBM25, searchSemantic, searchHybrid } from './search.js';
export { observe } from './observe.js';
export { context } from './context.js';
export type {
  ClawVaultConfig,
  SearchStrategy,
  SearchOptions,
  SearchResult,
  ObserveOptions,
  ObserveResult,
  ContextOptions,
  ContextResult,
  VaultStatus,
  Checkpoint,
} from './types.js';
