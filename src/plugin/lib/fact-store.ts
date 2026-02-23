import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtractedFact } from './fact-extractor.js';

const FACT_STORE_SCHEMA_VERSION = 1;
const FACT_STORE_RELATIVE_PATH = path.join('.clawvault', 'facts.json');

export interface StoredFact extends ExtractedFact {
  id: string;
  sessionId?: string;
}

interface FactStoreSnapshot {
  schemaVersion: number;
  updatedAt: string;
  facts: StoredFact[];
}

function ensureClawvaultDir(vaultPath: string): string {
  const clawvaultDir = path.join(vaultPath, '.clawvault');
  if (!fs.existsSync(clawvaultDir)) {
    fs.mkdirSync(clawvaultDir, { recursive: true });
  }
  return clawvaultDir;
}

function normalizeForLookup(value: string): string {
  return value.trim().toLowerCase();
}

function factDedupKey(subject: string, predicate: string, object: string): string {
  return `${normalizeForLookup(subject)}|${normalizeForLookup(predicate)}|${normalizeForLookup(object)}`;
}

function factId(fact: Pick<ExtractedFact, 'subject' | 'predicate' | 'object' | 'sourceText' | 'extractedAt'>): string {
  const digest = createHash('sha1')
    .update(`${fact.subject}|${fact.predicate}|${fact.object}|${fact.sourceText}|${fact.extractedAt}`)
    .digest('hex')
    .slice(0, 16);
  return `fact:${digest}`;
}

function isValidSnapshot(input: unknown): input is FactStoreSnapshot {
  if (!input || typeof input !== 'object') return false;
  const snapshot = input as FactStoreSnapshot;
  if (snapshot.schemaVersion !== FACT_STORE_SCHEMA_VERSION) return false;
  if (!Array.isArray(snapshot.facts)) return false;
  return true;
}

export class FactStore {
  private readonly storagePath: string;
  private facts: StoredFact[] = [];
  private dedupIndex = new Set<string>();

  constructor(private readonly vaultPath: string, initialFacts: StoredFact[] = []) {
    this.storagePath = path.join(vaultPath, FACT_STORE_RELATIVE_PATH);
    for (const fact of initialFacts) {
      this.addExistingFact(fact);
    }
  }

  static load(vaultPath: string): FactStore {
    const resolvedVaultPath = path.resolve(vaultPath);
    const storagePath = path.join(resolvedVaultPath, FACT_STORE_RELATIVE_PATH);

    if (!fs.existsSync(storagePath)) {
      return new FactStore(resolvedVaultPath);
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf-8')) as unknown;
      if (!isValidSnapshot(parsed)) {
        return new FactStore(resolvedVaultPath);
      }
      return new FactStore(resolvedVaultPath, parsed.facts);
    } catch {
      return new FactStore(resolvedVaultPath);
    }
  }

  addFact(fact: ExtractedFact, sessionId?: string): StoredFact | null {
    const key = factDedupKey(fact.subject, fact.predicate, fact.object);
    if (this.dedupIndex.has(key)) {
      return null;
    }

    const stored: StoredFact = {
      ...fact,
      id: factId(fact),
      sessionId
    };
    this.facts.push(stored);
    this.dedupIndex.add(key);
    return stored;
  }

  addFacts(facts: ExtractedFact[], sessionId?: string): StoredFact[] {
    const added: StoredFact[] = [];
    for (const fact of facts) {
      const stored = this.addFact(fact, sessionId);
      if (stored) {
        added.push(stored);
      }
    }
    return added;
  }

  getAllFacts(limit?: number): StoredFact[] {
    const sorted = [...this.facts].sort((a, b) => b.extractedAt.localeCompare(a.extractedAt));
    if (typeof limit === 'number' && limit >= 0) {
      return sorted.slice(0, limit);
    }
    return sorted;
  }

  getFactsForEntity(entity: string, limit: number = 50): StoredFact[] {
    const needle = normalizeForLookup(entity);
    if (!needle) return [];

    const matches = this.facts.filter((fact) => {
      const subject = normalizeForLookup(fact.subject);
      const object = normalizeForLookup(fact.object);
      return subject === needle || object === needle || subject.includes(needle) || object.includes(needle);
    });

    return matches
      .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt))
      .slice(0, limit);
  }

  query(query: string, limit: number = 20): StoredFact[] {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length === 0) return [];

    const scored = this.facts.map((fact) => {
      let score = 0;
      const subject = fact.subject.toLowerCase();
      const predicate = fact.predicate.toLowerCase();
      const object = fact.object.toLowerCase();
      const source = fact.sourceText.toLowerCase();

      for (const token of tokens) {
        if (subject.includes(token)) score += 2;
        if (object.includes(token)) score += 2;
        if (predicate.includes(token)) score += 1.5;
        if (source.includes(token)) score += 0.5;
      }

      return { fact, score };
    });

    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.fact.extractedAt.localeCompare(a.fact.extractedAt))
      .slice(0, limit)
      .map((entry) => entry.fact);
  }

  save(): void {
    ensureClawvaultDir(this.vaultPath);
    const snapshot: FactStoreSnapshot = {
      schemaVersion: FACT_STORE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      facts: this.getAllFacts()
    };
    fs.writeFileSync(this.storagePath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  private addExistingFact(fact: StoredFact): void {
    const key = factDedupKey(fact.subject, fact.predicate, fact.object);
    if (this.dedupIndex.has(key)) return;
    this.dedupIndex.add(key);
    this.facts.push(fact);
  }
}
