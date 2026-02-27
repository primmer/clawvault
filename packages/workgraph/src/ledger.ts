/**
 * Append-only event ledger.
 *
 * Format: one JSON object per line (.jsonl) in `.clawvault/ledger.jsonl`.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { LedgerEntry, LedgerOp } from './types.js';

const LEDGER_FILE = '.clawvault/ledger.jsonl';

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

export function ledgerPath(workspacePath: string): string {
  return path.join(workspacePath, LEDGER_FILE);
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

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Get the current owner of a target (last claim without a subsequent release/done). */
export function currentOwner(workspacePath: string, target: string): string | null {
  const entries = readAll(workspacePath).filter(e => e.target === target);
  let owner: string | null = null;

  for (const e of entries) {
    if (e.op === 'claim') owner = e.actor;
    if (e.op === 'release' || e.op === 'done' || e.op === 'cancel') owner = null;
  }

  return owner;
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
  const claims = new Map<string, string>();
  const entries = readAll(workspacePath);

  for (const e of entries) {
    if (e.op === 'claim') claims.set(e.target, e.actor);
    if (e.op === 'release' || e.op === 'done' || e.op === 'cancel') claims.delete(e.target);
  }

  return claims;
}

/** Get recent ledger entries (last N). */
export function recent(workspacePath: string, count: number = 20): LedgerEntry[] {
  const all = readAll(workspacePath);
  return all.slice(-count);
}
