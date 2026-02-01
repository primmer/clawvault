/**
 * ClawVault 🐘 — An Elephant Never Forgets
 * 
 * Structured memory system for AI agents with Obsidian-compatible markdown
 * and embedded semantic search.
 * 
 * @example
 * ```typescript
 * import { ClawVault, createVault, findVault } from 'clawvault';
 * 
 * // Create a new vault
 * const vault = await createVault('./my-memory');
 * 
 * // Store a memory
 * await vault.store({
 *   category: 'decisions',
 *   title: 'Use ClawVault',
 *   content: 'Decided to use ClawVault for memory management.'
 * });
 * 
 * // Search memories
 * const results = await vault.find('memory management');
 * console.log(results);
 * ```
 */

// Core exports
export { ClawVault, createVault, findVault } from './lib/vault.js';
export {
  SearchEngine,
  extractWikiLinks,
  extractTags,
  hasQmd,
  qmdUpdate,
  qmdEmbed,
  QmdUnavailableError,
  QMD_INSTALL_URL
} from './lib/search.js';

// Type exports
export type {
  VaultConfig,
  VaultMeta,
  Document,
  SearchResult,
  SearchOptions,
  StoreOptions,
  SyncOptions,
  SyncResult,
  Category,
  MemoryType,
  HandoffDocument,
  SessionRecap
} from './types.js';

export { DEFAULT_CATEGORIES, DEFAULT_CONFIG, MEMORY_TYPES, TYPE_TO_CATEGORY } from './types.js';

// Version
export const VERSION = '1.0.0';
