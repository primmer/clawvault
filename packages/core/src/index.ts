/**
 * @versatly/clawvault-core
 * 
 * Core engine for ClawVault: search, templates, observation, workgraph, replay.
 * This is a workspace-internal package — CLI and plugin depend on it.
 */

// === lib ===
export { ClawVault, createVault, findVault } from './lib/vault.js';
export { getVaultPath, findNearestVaultPath, resolveVaultPath } from './lib/config.js';
export {
  SearchEngine,
  extractWikiLinks,
  extractTags,
  hasQmd,
  qmdUpdate,
  qmdEmbed,
  QmdUnavailableError,
  QMD_INSTALL_COMMAND,
  QMD_INSTALL_URL,
  sentenceChunk,
  bm25RankChunks,
  extractDates,
  extractPreferences,
  classifyQuestion,
} from './lib/search.js';
export {
  SUPPORTED_CONFIG_KEYS,
  getConfig,
  listConfig,
  getConfigValue,
  setConfigValue,
  resetConfig,
  listRouteRules,
  addRouteRule,
  removeRouteRule,
  matchRouteRule,
  testRouteRule,
} from './lib/config-manager.js';
export type {
  ManagedConfigKey,
  RouteRule,
  ObserveProvider,
  ObserverCompressionProvider,
  Theme,
  ContextProfile as ConfigDefaultProfile,
} from './lib/config-manager.js';
export {
  MEMORY_GRAPH_SCHEMA_VERSION,
  buildOrUpdateMemoryGraphIndex,
  getMemoryGraph,
  loadMemoryGraphIndex,
} from './lib/memory-graph.js';
export type {
  MemoryGraph,
  MemoryGraphNode,
  MemoryGraphEdge,
  MemoryGraphEdgeType,
  MemoryGraphNodeType,
  MemoryGraphIndex,
  MemoryGraphStats,
} from './lib/memory-graph.js';
export {
  inferContextProfile,
  normalizeContextProfileInput,
  resolveContextProfile,
} from './lib/context-profile.js';
export type { ContextProfileInput, ResolvedContextProfile } from './lib/context-profile.js';
export {
  indexInjectableItems,
  deterministicInjectMatches,
  runPromptInjection,
} from './lib/inject-utils.js';
export type {
  InjectableItem,
  InjectMatchSource,
  InjectMatchReason,
  InjectMatch,
  InjectResult,
  InjectRuntimeOptions,
  InjectSourceCategory,
} from './lib/inject-utils.js';
export { resolveLlmProvider, requestLlmCompletion } from './lib/llm-provider.js';
export type { LlmProvider, LlmCompletionOptions } from './lib/llm-provider.js';
export {
  renderTemplate,
  buildTemplateVariables,
} from './lib/template-engine.js';
export type { TemplateVariables } from './lib/template-engine.js';
export {
  updateTask,
  completeTask,
  listSubtasks,
  listDependentTasks,
} from './lib/task-utils.js';
export {
  listProjects,
  readProject,
  createProject,
  updateProject,
  archiveProject,
  getProjectTasks,
  getProjectActivity,
} from './lib/project-utils.js';
export type { ProjectStatus, ProjectFrontmatter, Project } from './lib/project-utils.js';
export {
  reweave,
  isSuperseded,
  getSupersessionInfo,
  extractEntities,
  entitySimilarity,
  isKnowledgeUpdate,
  filterSuperseded,
  stripSupersededObservations,
} from './lib/reweave.js';
export type { SupersessionRecord, ReweaveResult, ReweaveOptions } from './lib/reweave.js';
export {
  appendTransition,
  buildTransitionEvent,
  readAllTransitions,
  queryTransitions,
  countBlockedTransitions,
  isRegression,
  formatTransitionsTable,
} from './lib/transition-ledger.js';
export type { TransitionEvent } from './lib/transition-ledger.js';
export { formatAge } from './lib/time.js';
export { scanVaultLinks } from './lib/backlinks.js';
export { estimateTokens } from './lib/token-counter.js';
export { buildEntityIndex } from './lib/entity-index.js';

// === observer ===
export { Observer } from './observer/observer.js';
export type { ObserverOptions, ObserverCompressor, ObserverReflector } from './observer/observer.js';
export {
  observeActiveSessions,
  getScaledObservationThresholdBytes,
  parseSessionSourceLabel,
  getObserverStaleness,
} from './observer/active-session-observer.js';
export type {
  ActiveObserveOptions,
  ActiveObserveResult,
  ActiveObservationCandidate,
  ActiveObservationFailure,
  ObserveCursorEntry,
  ObserveCursorStore,
  ObserverStalenessResult,
} from './observer/active-session-observer.js';
export { Compressor } from './observer/compressor.js';
export type { CompressorOptions, CompressionProvider } from './observer/compressor.js';
export { Reflector } from './observer/reflector.js';
export type { ReflectorOptions } from './observer/reflector.js';
export { SessionWatcher } from './observer/watcher.js';
export type { SessionWatcherOptions } from './observer/watcher.js';
export { parseSessionFile } from './observer/session-parser.js';
export { runReflection } from './observer/reflection-service.js';
export type { ReflectOptions, ReflectResult } from './observer/reflection-service.js';
export { archiveObservations } from './observer/archive.js';
export type { ArchiveObservationsOptions, ArchiveObservationsResult } from './observer/archive.js';

// === types ===
export type {
  VaultConfig,
  VaultMeta,
  Document,
  SearchResult,
  SearchOptions,
  ExtractedDate,
  ExtractedPreference,
  StoreOptions,
  SyncOptions,
  SyncResult,
  Category,
  MemoryType,
  HandoffDocument,
  SessionRecap,
} from './types.js';
export { DEFAULT_CATEGORIES, DEFAULT_CONFIG, MEMORY_TYPES, TYPE_TO_CATEGORY } from './types.js';
