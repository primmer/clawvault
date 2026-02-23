/**
 * ClawVault Memory Provider
 * 
 * Harness-agnostic interface for memory operations.
 * Can be consumed by LangGraph, CrewAI, AutoGen, or any other framework.
 */

import {
  ClawVault,
  findVault,
  createVault,
  Observer,
  type SearchResult as ClawSearchResult,
} from '../../index.js';

import type {
  Message,
  SearchResult,
  SearchOptions,
  Preference,
  DateIndex,
  IngestResult,
  VaultStatus,
  QueryType,
} from '../types.js';
import { extractFactsRuleBased } from '../lib/fact-extractor.js';
import { FactStore } from '../lib/fact-store.js';
import { EntityGraph, type EntityGraphQueryResult } from '../lib/entity-graph.js';

export interface MemoryProviderOptions {
  vaultPath: string;
  bm25PrefilterK?: number;
  exhaustiveThreshold?: number;
  defaultLimit?: number;
}

export interface MemoryProvider {
  ingest(sessionId: string, messages: Message[], date?: Date): Promise<IngestResult>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  getPreferences(): Promise<Preference[]>;
  getDates(): Promise<DateIndex[]>;
  getStatus(): Promise<VaultStatus>;
}

/**
 * ClawVault Memory Provider implementation
 * 
 * Features:
 * - Chunk-level BM25 pre-filtering
 * - Exhaustive threshold-based retrieval
 * - Preference extraction at ingest time
 * - Temporal date indexing at ingest time
 * - Smart query routing (auto-detect question type)
 */
export class ClawVaultMemoryProvider implements MemoryProvider {
  private vault: ClawVault | null = null;
  private observer: Observer | null = null;
  private preferences: Map<string, Preference> = new Map();
  private dateIndex: Map<string, DateIndex> = new Map();
  private factStore: FactStore | null = null;
  private entityGraph: EntityGraph | null = null;
  private readonly options: Required<MemoryProviderOptions>;

  constructor(options: MemoryProviderOptions) {
    this.options = {
      vaultPath: options.vaultPath,
      bm25PrefilterK: options.bm25PrefilterK ?? 50,
      exhaustiveThreshold: options.exhaustiveThreshold ?? 0.3,
      defaultLimit: options.defaultLimit ?? 10,
    };
  }

  async initialize(): Promise<void> {
    this.vault = await findVault(this.options.vaultPath);
    if (!this.vault) {
      this.vault = await createVault(this.options.vaultPath);
    }
    this.observer = new Observer(this.options.vaultPath, {
      tokenThreshold: 2000,
    });
    this.factStore = FactStore.load(this.options.vaultPath);
    this.entityGraph = EntityGraph.load(this.options.vaultPath);
    await this.loadPersistedData();
  }

  async ingest(sessionId: string, messages: Message[], date?: Date): Promise<IngestResult> {
    if (!this.vault || !this.observer) {
      await this.initialize();
    }
    if (!this.factStore) {
      this.factStore = FactStore.load(this.options.vaultPath);
    }
    if (!this.entityGraph) {
      this.entityGraph = EntityGraph.load(this.options.vaultPath);
    }

    const ingestDate = date ?? new Date();
    const messageStrings = messages.map(m => this.formatMessage(m));
    
    await this.observer!.processMessages(messageStrings, {
      sessionKey: sessionId,
      timestamp: ingestDate,
    });

    const userMessages = messages.filter((message) => message.role === 'user').map((message) => message.content);
    const extractedFacts = extractFactsRuleBased(userMessages);
    const addedFacts = this.factStore.addFacts(extractedFacts, sessionId);
    for (const fact of addedFacts) {
      this.entityGraph.addFact(fact);
    }

    const extractedPrefs = this.extractPreferences(messages);
    for (const pref of extractedPrefs) {
      const key = `${pref.category}:${pref.item}`;
      this.preferences.set(key, pref);
    }

    const extractedDates = this.extractDates(messages, ingestDate);
    for (const dateEntry of extractedDates) {
      const existing = this.dateIndex.get(dateEntry.date);
      if (existing) {
        existing.events.push(...dateEntry.events);
        existing.documents = [...new Set([...existing.documents, ...dateEntry.documents])];
      } else {
        this.dateIndex.set(dateEntry.date, dateEntry);
      }
    }

    await this.persistData();

    return {
      documentsCreated: messageStrings.length,
      preferencesExtracted: extractedPrefs.length,
      datesIndexed: extractedDates.length,
      sessionId,
    };
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!this.vault) {
      await this.initialize();
    }
    if (!this.entityGraph) {
      this.entityGraph = EntityGraph.load(this.options.vaultPath);
    }

    const limit = options?.limit ?? this.options.defaultLimit;
    const requestedType = options?.queryType;
    const queryType = !requestedType || requestedType === 'auto' ? this.classifyQuestion(query) : requestedType;

    if (queryType === 'entity') {
      const graphResults = this.searchEntityGraph(query, limit);
      if (graphResults.length > 0) {
        return graphResults;
      }
    }

    if (queryType === 'preference') {
      return this.searchPreferences(query, limit);
    }

    if (queryType === 'temporal') {
      return this.searchTemporal(query, options);
    }

    return this.smartQuery(query, {
      ...options,
      limit,
    });
  }

  async getPreferences(): Promise<Preference[]> {
    return Array.from(this.preferences.values());
  }

  async getDates(): Promise<DateIndex[]> {
    return Array.from(this.dateIndex.values()).sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  async getStatus(): Promise<VaultStatus> {
    if (!this.vault) {
      return {
        initialized: false,
        documentCount: 0,
        categories: {},
        preferencesCount: 0,
        datesIndexedCount: 0,
      };
    }

    const stats = await this.vault.stats();
    return {
      initialized: this.vault.isInitialized(),
      documentCount: stats.documents,
      categories: stats.categories,
      lastActivity: new Date(),
      preferencesCount: this.preferences.size,
      datesIndexedCount: this.dateIndex.size,
    };
  }

  /**
   * Smart query routing - auto-detects question type and routes appropriately
   */
  private async smartQuery(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const limit = options?.limit ?? this.options.defaultLimit;
    const prefilterK = this.options.bm25PrefilterK;

    const bm25Results = await this.vault!.find(query, { limit: prefilterK });

    const threshold = options?.threshold ?? this.options.exhaustiveThreshold;
    const exhaustiveResults = this.exhaustiveSearch(bm25Results, threshold);

    const finalResults = exhaustiveResults.slice(0, limit);

    return finalResults.map(r => this.convertSearchResult(r));
  }

  /**
   * Exhaustive threshold-based retrieval
   * Returns all results above the threshold score
   */
  private exhaustiveSearch(
    candidates: ClawSearchResult[],
    threshold: number
  ): ClawSearchResult[] {
    return candidates.filter(r => r.score >= threshold);
  }

  /**
   * Classify question type for smart routing
   */
  private classifyQuestion(query: string): QueryType {
    const lowerQuery = query.toLowerCase();

    const preferencePatterns = [
      /(?:do|does|did)\s+(?:i|you|we|they)\s+(?:like|prefer|enjoy|want|hate|dislike)/i,
      /(?:what|which)\s+(?:do|does|did)\s+(?:i|you|we)\s+(?:like|prefer|enjoy)/i,
      /(?:my|your|our)\s+(?:favorite|preferred|favourite)/i,
      /(?:preference|preferences)\s+(?:for|about|regarding)/i,
    ];

    for (const pattern of preferencePatterns) {
      if (pattern.test(lowerQuery)) {
        return 'preference';
      }
    }

    const temporalPatterns = [
      /(?:when|what\s+time|what\s+date|which\s+day)/i,
      /(?:yesterday|today|tomorrow|last\s+week|next\s+week)/i,
      /(?:january|february|march|april|may|june|july|august|september|october|november|december)/i,
      /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/,
      /(?:schedule|scheduled|appointment|meeting|event)\s+(?:on|at|for)/i,
    ];

    for (const pattern of temporalPatterns) {
      if (pattern.test(lowerQuery)) {
        return 'temporal';
      }
    }

    const entityPatterns = [
      /(?:who|what)\s+(?:is|are)\s+([a-z0-9][a-z0-9\s._-]{1,80})/i,
      /(?:related to|connected to|about|relationship between)\s+([a-z0-9][a-z0-9\s._-]{1,80})/i,
      /\b(?:entity|entities|graph)\b/i
    ];

    for (const pattern of entityPatterns) {
      if (pattern.test(query)) {
        return 'entity';
      }
    }

    const factualPatterns = [
      /^(?:what|who|where|how|why)\s+(?:is|are|was|were|did|does|do)/i,
      /(?:tell\s+me|explain|describe|define)/i,
    ];

    for (const pattern of factualPatterns) {
      if (pattern.test(lowerQuery)) {
        return 'factual';
      }
    }

    return 'semantic';
  }

  /**
   * Search preferences based on query
   */
  private searchPreferences(query: string, limit: number): SearchResult[] {
    const lowerQuery = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const pref of this.preferences.values()) {
      const matchScore = this.calculatePreferenceMatch(pref, lowerQuery);
      if (matchScore > 0) {
        results.push({
          id: `pref:${pref.category}:${pref.item}`,
          title: `${pref.category}: ${pref.item}`,
          content: `${pref.sentiment} preference for ${pref.item} in ${pref.category}`,
          snippet: `Sentiment: ${pref.sentiment}, Confidence: ${pref.confidence}`,
          score: matchScore,
          category: 'preferences',
          metadata: { preference: pref },
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Search temporal index based on query
   */
  private async searchTemporal(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const limit = options?.limit ?? this.options.defaultLimit;
    const results: SearchResult[] = [];

    const dateRange = options?.dateRange;
    const filteredDates = Array.from(this.dateIndex.values()).filter(entry => {
      const entryDate = new Date(entry.date);
      if (dateRange?.start && entryDate < dateRange.start) return false;
      if (dateRange?.end && entryDate > dateRange.end) return false;
      return true;
    });

    for (const dateEntry of filteredDates) {
      for (const event of dateEntry.events) {
        const matchScore = this.calculateTextMatch(event.title, query);
        if (matchScore > 0.1) {
          results.push({
            id: `date:${dateEntry.date}:${event.documentId}`,
            title: event.title,
            content: `Event on ${dateEntry.date}: ${event.title}`,
            snippet: `Date: ${dateEntry.date}, Type: ${event.type ?? 'general'}`,
            score: matchScore,
            category: 'temporal',
            metadata: { date: dateEntry.date, event },
          });
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private searchEntityGraph(query: string, limit: number): SearchResult[] {
    if (!this.entityGraph) {
      return [];
    }

    const entityTarget = this.extractEntityTarget(query);
    if (!entityTarget) {
      return [];
    }

    const hopCount = this.extractHopCount(query);
    const graphResult = this.entityGraph.queryMultiHop(entityTarget, hopCount, Math.max(limit * 4, 20));
    if (graphResult.nodes.length === 0 || graphResult.edges.length === 0) {
      return [];
    }

    const related = this.entityGraph.findRelated(entityTarget, limit);
    const timeline = this.entityGraph.getTimeline(entityTarget).slice(0, limit);

    return [
      this.buildEntitySearchResult(entityTarget, graphResult, related.length, timeline.length)
    ];
  }

  private buildEntitySearchResult(
    entityTarget: string,
    graphResult: EntityGraphQueryResult,
    relatedCount: number,
    timelineCount: number
  ): SearchResult {
    const content = this.entityGraph?.formatForContext(graphResult) ?? 'No entity graph matches found.';

    return {
      id: `entity:${entityTarget.toLowerCase().replace(/\s+/g, '_')}`,
      title: `Entity graph: ${entityTarget}`,
      content,
      snippet: `${graphResult.nodes.length} nodes, ${graphResult.edges.length} edges, ${graphResult.hops}-hop traversal`,
      score: 1,
      category: 'entity-graph',
      metadata: {
        entity: entityTarget,
        hops: graphResult.hops,
        nodes: graphResult.nodes.length,
        edges: graphResult.edges.length,
        relatedCount,
        timelineCount
      }
    };
  }

  private extractEntityTarget(query: string): string | null {
    const quoted = query.match(/"([^"]+)"/);
    if (quoted?.[1]) {
      return quoted[1].trim();
    }

    const patterns = [
      /(?:who|what)\s+(?:is|are)\s+([a-z0-9][a-z0-9\s._-]{1,80})/i,
      /(?:related to|connected to|about)\s+([a-z0-9][a-z0-9\s._-]{1,80})/i,
      /(?:relationship between)\s+([a-z0-9][a-z0-9\s._-]{1,80})/i
    ];

    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match?.[1]) {
        return match[1].replace(/[?.!,]+$/, '').trim();
      }
    }

    const words = query
      .replace(/[?.!,]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    if (words.length === 0) return null;
    const fallback = words.slice(-3).join(' ').trim();
    return fallback || null;
  }

  private extractHopCount(query: string): number {
    const match = query.match(/(\d+)\s*-?\s*hop/i);
    if (!match?.[1]) return 2;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isNaN(parsed)) return 2;
    return Math.min(Math.max(parsed, 1), 4);
  }

  /**
   * Extract preferences from messages
   */
  private extractPreferences(messages: Message[]): Preference[] {
    const preferences: Preference[] = [];
    const now = new Date();

    const patterns = [
      { regex: /i (?:really )?(?:like|love|enjoy|prefer)\s+(.+?)(?:\.|,|$)/gi, sentiment: 'positive' as const },
      { regex: /i (?:don't|do not|hate|dislike)\s+(.+?)(?:\.|,|$)/gi, sentiment: 'negative' as const },
      { regex: /my favorite\s+(.+?)\s+is\s+(.+?)(?:\.|,|$)/gi, sentiment: 'positive' as const, hasCategory: true },
      { regex: /i prefer\s+(.+?)\s+over\s+(.+?)(?:\.|,|$)/gi, sentiment: 'positive' as const },
    ];

    for (const message of messages) {
      if (message.role !== 'user') continue;
      const content = message.content;

      for (const { regex, sentiment, hasCategory } of patterns) {
        let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(content)) !== null) {
          if (hasCategory && match[2]) {
            preferences.push({
              category: this.normalizeCategory(match[1]),
              item: match[2].trim(),
              sentiment,
              confidence: 0.8,
              source: content.slice(0, 100),
              extractedAt: now,
            });
          } else if (match[1]) {
            const item = match[1].trim();
            preferences.push({
              category: this.inferCategory(item),
              item,
              sentiment,
              confidence: 0.7,
              source: content.slice(0, 100),
              extractedAt: now,
            });
          }
        }
      }
    }

    return preferences;
  }

  /**
   * Extract dates from messages for temporal indexing
   */
  private extractDates(messages: Message[], sessionDate: Date): DateIndex[] {
    const dateEntries: Map<string, DateIndex> = new Map();

    const datePatterns = [
      /(?:on|at|for|scheduled for)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
      /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?/gi,
      /(tomorrow|yesterday|today|next\s+(?:week|month|year)|last\s+(?:week|month|year))/gi,
    ];

    for (const message of messages) {
      const content = message.content;
      
      for (const pattern of datePatterns) {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          const dateStr = this.parseDateString(match[0], sessionDate);
          if (dateStr) {
            const existing = dateEntries.get(dateStr);
            const event = {
              title: this.extractEventContext(content, match.index),
              documentId: `msg:${message.timestamp ?? Date.now()}`,
              type: this.inferEventType(content),
            };

            if (existing) {
              existing.events.push(event);
            } else {
              dateEntries.set(dateStr, {
                date: dateStr,
                documents: [`msg:${message.timestamp ?? Date.now()}`],
                events: [event],
              });
            }
          }
        }
      }
    }

    return Array.from(dateEntries.values());
  }

  private formatMessage(message: Message): string {
    const role = message.role.charAt(0).toUpperCase() + message.role.slice(1);
    return `${role}: ${message.content}`;
  }

  private convertSearchResult(result: ClawSearchResult): SearchResult {
    return {
      id: result.document.id,
      title: result.document.title,
      content: result.document.content,
      snippet: result.snippet,
      score: result.score,
      category: result.document.category,
      path: result.document.path,
      modifiedAt: result.document.modified,
    };
  }

  private calculatePreferenceMatch(pref: Preference, query: string): number {
    let score = 0;
    if (query.includes(pref.item.toLowerCase())) score += 0.5;
    if (query.includes(pref.category.toLowerCase())) score += 0.3;
    if (query.includes(pref.sentiment)) score += 0.2;
    return score * pref.confidence;
  }

  private calculateTextMatch(text: string, query: string): number {
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);
    
    let matches = 0;
    for (const word of queryWords) {
      if (textLower.includes(word)) matches++;
    }
    
    return queryWords.length > 0 ? matches / queryWords.length : 0;
  }

  private normalizeCategory(category: string): string {
    return category.toLowerCase().trim().replace(/\s+/g, '_');
  }

  private inferCategory(item: string): string {
    const foodKeywords = ['pizza', 'coffee', 'tea', 'food', 'restaurant', 'cuisine', 'dish'];
    const techKeywords = ['programming', 'code', 'software', 'app', 'technology', 'framework'];
    const entertainmentKeywords = ['movie', 'music', 'book', 'game', 'show', 'series'];

    const itemLower = item.toLowerCase();
    
    if (foodKeywords.some(k => itemLower.includes(k))) return 'food';
    if (techKeywords.some(k => itemLower.includes(k))) return 'technology';
    if (entertainmentKeywords.some(k => itemLower.includes(k))) return 'entertainment';
    
    return 'general';
  }

  private parseDateString(dateStr: string, reference: Date): string | null {
    const lower = dateStr.toLowerCase();
    
    if (lower.includes('today')) {
      return reference.toISOString().split('T')[0];
    }
    if (lower.includes('tomorrow')) {
      const tomorrow = new Date(reference);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    }
    if (lower.includes('yesterday')) {
      const yesterday = new Date(reference);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toISOString().split('T')[0];
    }

    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    return null;
  }

  private extractEventContext(content: string, matchIndex: number): string {
    const start = Math.max(0, matchIndex - 50);
    const end = Math.min(content.length, matchIndex + 100);
    return content.slice(start, end).trim();
  }

  private inferEventType(content: string): string {
    const lower = content.toLowerCase();
    if (lower.includes('meeting')) return 'meeting';
    if (lower.includes('appointment')) return 'appointment';
    if (lower.includes('deadline')) return 'deadline';
    if (lower.includes('birthday')) return 'birthday';
    if (lower.includes('event')) return 'event';
    return 'general';
  }

  private async loadPersistedData(): Promise<void> {
    try {
      if (!this.factStore) {
        this.factStore = FactStore.load(this.options.vaultPath);
      }
      if (!this.entityGraph) {
        this.entityGraph = EntityGraph.load(this.options.vaultPath);
      }

      const prefsDoc = await this.vault?.get('_system/preferences');
      if (prefsDoc?.content) {
        const data = JSON.parse(prefsDoc.content);
        for (const pref of data.preferences ?? []) {
          const key = `${pref.category}:${pref.item}`;
          this.preferences.set(key, {
            ...pref,
            extractedAt: new Date(pref.extractedAt),
          });
        }
      }

      const datesDoc = await this.vault?.get('_system/date_index');
      if (datesDoc?.content) {
        const data = JSON.parse(datesDoc.content);
        for (const entry of data.dates ?? []) {
          this.dateIndex.set(entry.date, entry);
        }
      }
    } catch {
      // Ignore errors loading persisted data
    }
  }

  private async persistData(): Promise<void> {
    try {
      await this.vault?.store({
        category: '_system',
        title: 'preferences',
        content: JSON.stringify({
          preferences: Array.from(this.preferences.values()),
          updatedAt: new Date().toISOString(),
        }),
      });

      await this.vault?.store({
        category: '_system',
        title: 'date_index',
        content: JSON.stringify({
          dates: Array.from(this.dateIndex.values()),
          updatedAt: new Date().toISOString(),
        }),
      });

      this.factStore?.save();
      this.entityGraph?.save();
    } catch {
      // Ignore errors persisting data
    }
  }
}

export function createMemoryProvider(options: MemoryProviderOptions): MemoryProvider {
  return new ClawVaultMemoryProvider(options);
}
