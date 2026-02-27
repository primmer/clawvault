/**
 * Append-only event ledger.
 *
 * Format: one JSON object per line (.jsonl) in `.clawvault/ledger.jsonl`.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { LedgerEntry, LedgerIndex, LedgerOp } from './types.js';

const LEDGER_FILE = '.clawvault/ledger.jsonl';
const LEDGER_INDEX_FILE = '.clawvault/ledger-index.json';
const LEDGER_INDEX_VERSION = 1;

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

export function ledgerPath(workspacePath: string): string {
  return path.join(workspacePath, LEDGER_FILE);
}

export function ledgerIndexPath(workspacePath: string): string {
  return path.join(workspacePath, LEDGER_INDEX_FILE);
}

export function append(
  workspacePath: string,
  actor: string,
  op: LedgerOp,
  target: string,
  type?: string,
  data?: Record<string, unknown>,
): LedgerEntry {
  const entry: LedgerEntry = {
    ts: new Date().toISOString(),
    actor,
    op,
    target,
    ...(type ? { type } : {}),
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
  };

  const lPath = ledgerPath(workspacePath);
  const dir = path.dirname(lPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(lPath, JSON.stringify(entry) + '\n', 'utf-8');
  updateIndexWithEntry(workspacePath, entry);
  return entry;
}

export function readAll(workspacePath: string): LedgerEntry[] {
  const lPath = ledgerPath(workspacePath);
  if (!fs.existsSync(lPath)) return [];

  const lines = fs.readFileSync(lPath, 'utf-8').split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line) as LedgerEntry);
}

export function readSince(workspacePath: string, since: string): LedgerEntry[] {
  return readAll(workspacePath).filter(e => e.ts >= since);
}

export function loadIndex(workspacePath: string): LedgerIndex | null {
  const idxPath = ledgerIndexPath(workspacePath);
  if (!fs.existsSync(idxPath)) return null;
  try {
    const raw = fs.readFileSync(idxPath, 'utf-8');
    return JSON.parse(raw) as LedgerIndex;
  } catch {
    return null;
  }
}

export function rebuildIndex(workspacePath: string): LedgerIndex {
  const index = seedIndex();
  const entries = readAll(workspacePath);
  for (const entry of entries) {
    applyClaimMutation(index, entry);
    index.lastEntryTs = entry.ts;
  }
  saveIndex(workspacePath, index);
  return index;
}

export function claimsFromIndex(workspacePath: string): Map<string, string> {
  try {
    const index = loadIndex(workspacePath);
    if (index?.version === LEDGER_INDEX_VERSION) {
      return new Map(Object.entries(index.claims));
    }
    const rebuilt = rebuildIndex(workspacePath);
    return new Map(Object.entries(rebuilt.claims));
  } catch {
    return claimsFromLedger(workspacePath);
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Get the current owner of a target (last claim without a subsequent release/done). */
export function currentOwner(workspacePath: string, target: string): string | null {
  return allClaims(workspacePath).get(target) ?? null;
}

/** Check if a target is currently claimed by any agent. */
export function isClaimed(workspacePath: string, target: string): boolean {
  return currentOwner(workspacePath, target) !== null;
}

/** Get all entries for a specific target. */
export function historyOf(workspacePath: string, target: string): LedgerEntry[] {
  return readAll(workspacePath).filter(e => e.target === target);
}

/** Get all entries by a specific actor. */
export function activityOf(workspacePath: string, actor: string): LedgerEntry[] {
  return readAll(workspacePath).filter(e => e.actor === actor);
}

/** Get all currently claimed targets and their owners. */
export function allClaims(workspacePath: string): Map<string, string> {
  return claimsFromIndex(workspacePath);
}

/** Get recent ledger entries (last N). */
export function recent(workspacePath: string, count: number = 20): LedgerEntry[] {
  const all = readAll(workspacePath);
  return all.slice(-count);
}

function updateIndexWithEntry(workspacePath: string, entry: LedgerEntry): void {
  const index = loadIndex(workspacePath) ?? seedIndex();
  applyClaimMutation(index, entry);
  index.lastEntryTs = entry.ts;
  saveIndex(workspacePath, index);
}

function saveIndex(workspacePath: string, index: LedgerIndex): void {
  const idxPath = ledgerIndexPath(workspacePath);
  const dir = path.dirname(idxPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(idxPath, JSON.stringify(index, null, 2) + '\n', 'utf-8');
}

function seedIndex(): LedgerIndex {
  return {
    version: LEDGER_INDEX_VERSION,
    lastEntryTs: '',
    claims: {},
  };
}

function applyClaimMutation(index: LedgerIndex, entry: LedgerEntry): void {
  if (entry.op === 'claim') {
    index.claims[entry.target] = entry.actor;
    return;
  }
  if (entry.op === 'release' || entry.op === 'done' || entry.op === 'cancel') {
    delete index.claims[entry.target];
  }
}

function claimsFromLedger(workspacePath: string): Map<string, string> {
  const claims = new Map<string, string>();
  const entries = readAll(workspacePath);
  for (const entry of entries) {
    if (entry.op === 'claim') claims.set(entry.target, entry.actor);
    if (entry.op === 'release' || entry.op === 'done' || entry.op === 'cancel') {
      claims.delete(entry.target);
    }
  }
  return claims;
}
