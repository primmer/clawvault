/**
 * Reweave — Backward memory consolidation for ClawVault
 *
 * When new observations are written, reweave performs a backward pass over
 * existing observations to detect knowledge updates (same entity, new value).
 * Older observations are marked as superseded so search always returns the
 * latest version of a fact.
 *
 * Design inspired by Ars Contexta's "notes are hypotheses" philosophy —
 * every observation is a claim that can be superseded by newer evidence.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parseObservationMarkdown,
  renderScoredObservationLine,
  type ParsedObservationRecord,
  DATE_HEADING_RE,
} from './observation-format.js';
import {
  listObservationFiles,
  getObservationPath,
  type ObservationFileEntry,
} from './ledger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupersessionRecord {
  /** The older observation that was superseded */
  oldObservation: ParsedObservationRecord;
  /** The newer observation that supersedes it */
  newObservation: ParsedObservationRecord;
  /** File path of the older observation */
  oldFile: string;
  /** File path of the newer observation */
  newFile: string;
  /** Reason for supersession */
  reason: string;
  /** Timestamp of detection */
  detectedAt: string;
}

export interface ReweaveResult {
  /** Number of observation files scanned */
  filesScanned: number;
  /** Number of individual observations checked */
  observationsChecked: number;
  /** Supersession records found/applied */
  supersessions: SupersessionRecord[];
  /** Whether this was a dry run */
  dryRun: boolean;
}

export interface ReweaveOptions {
  vaultPath: string;
  /** Only process observations since this date (YYYY-MM-DD) */
  since?: string;
  /** Dry run — report but don't write */
  dryRun?: boolean;
  /** Similarity threshold for entity matching (0-1). Default 0.6 */
  similarityThreshold?: number;
}

// ---------------------------------------------------------------------------
// Supersession metadata format
// ---------------------------------------------------------------------------

/**
 * Marker appended to superseded observation lines.
 * Format: [superseded|by=<date>|detected=<date>]
 * 
 * We append this to the raw line so the observation file remains
 * human-readable markdown while carrying structured metadata.
 */
const SUPERSEDED_MARKER_RE = /\[superseded\|by=([^\]|]+)\|detected=([^\]]+)\]/;

export function isSuperseded(line: string): boolean {
  return SUPERSEDED_MARKER_RE.test(line);
}

export function getSupersessionInfo(line: string): { supersededBy: string; detectedAt: string } | null {
  const m = line.match(SUPERSEDED_MARKER_RE);
  if (!m) return null;
  return { supersededBy: m[1], detectedAt: m[2] };
}

function makeSupersededMarker(supersedingDate: string, detectedAt: string): string {
  return ` [superseded|by=${supersedingDate}|detected=${detectedAt}]`;
}

// ---------------------------------------------------------------------------
// Entity extraction — lightweight, no LLM needed
// ---------------------------------------------------------------------------

/**
 * Extract key entities/subjects from an observation for matching.
 * Returns normalized tokens that represent the "what" of the observation.
 */
export function extractEntities(content: string): string[] {
  const normalized = content.toLowerCase().replace(/['']/g, "'");

  // Extract quoted values
  const quoted: string[] = [];
  for (const m of normalized.matchAll(/[""]([^""]+)[""]/g)) {
    quoted.push(m[1].trim());
  }
  for (const m of normalized.matchAll(/"([^"]+)"/g)) {
    quoted.push(m[1].trim());
  }

  // Extract key noun phrases (simple heuristic)
  // Look for patterns like "X is Y", "X changed to Y", "X's Y is Z"
  const patterns = [
    /(\w[\w\s]{1,30}?)\s+(?:is|are|was|were|changed to|switched to|moved to|updated to|now uses?|now lives?|now works?)\s+/gi,
    /(?:uses?|prefers?|likes?|lives? (?:in|at)|works? (?:at|for)|drives?|owns?)\s+([\w\s]{2,30})/gi,
    /(\w[\w\s]{1,20}?)'s\s+(\w[\w\s]{1,20})/gi,
  ];

  const phrases: string[] = [...quoted];
  for (const pat of patterns) {
    for (const m of content.matchAll(pat)) {
      if (m[1]) phrases.push(m[1].trim().toLowerCase());
      if (m[2]) phrases.push(m[2].trim().toLowerCase());
    }
  }

  // Also extract individual significant words
  const stopwords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both',
    'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
    'too', 'very', 'just', 'because', 'that', 'this', 'these', 'those',
    'it', 'its', 'he', 'she', 'they', 'we', 'you', 'i', 'me', 'my',
    'his', 'her', 'our', 'your', 'their', 'pedro', 'clawdious',
  ]);

  const words = normalized
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));

  return [...new Set([...phrases, ...words])].filter(Boolean);
}

/**
 * Compute similarity between two observations based on entity overlap.
 * Returns 0-1 where 1 = identical entities.
 */
export function entitySimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let overlap = 0;
  for (const item of setA) {
    if (setB.has(item)) overlap++;
  }
  // Jaccard similarity
  const union = new Set([...a, ...b]).size;
  return union > 0 ? overlap / union : 0;
}

/**
 * Check if two observations represent a knowledge update.
 * Both must be about the same entity/subject but with different values.
 * 
 * Heuristic: high entity overlap + different observation content = update.
 * Same content = duplicate, not update.
 */
export function isKnowledgeUpdate(
  older: ParsedObservationRecord,
  newer: ParsedObservationRecord,
  threshold = 0.3,
): { isUpdate: boolean; reason: string } {
  // Only compare compatible types
  const updateableTypes = new Set(['fact', 'preference', 'decision', 'commitment', 'project', 'relationship']);
  if (!updateableTypes.has(older.type) && !updateableTypes.has(newer.type)) {
    return { isUpdate: false, reason: 'non-updateable types' };
  }

  const olderEntities = extractEntities(older.content);
  const newerEntities = extractEntities(newer.content);
  const similarity = entitySimilarity(olderEntities, newerEntities);

  if (similarity < threshold) {
    return { isUpdate: false, reason: `low entity similarity: ${similarity.toFixed(2)}` };
  }

  // Check if content is identical (dedup, not update)
  const normalizeContent = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalizeContent(older.content) === normalizeContent(newer.content)) {
    return { isUpdate: false, reason: 'identical content' };
  }

  // High similarity + different content = knowledge update
  return {
    isUpdate: true,
    reason: `entity overlap ${similarity.toFixed(2)}: entities=[${olderEntities.slice(0, 3).join(', ')}]`,
  };
}

// ---------------------------------------------------------------------------
// Core reweave algorithm
// ---------------------------------------------------------------------------

/**
 * Load all observations from vault, grouped by file.
 */
function loadObservations(
  vaultPath: string,
  since?: string,
): Array<{ file: ObservationFileEntry; records: ParsedObservationRecord[] }> {
  const files = listObservationFiles(vaultPath, {
    fromDate: since,
  });

  return files.map(f => {
    const content = fs.readFileSync(f.path, 'utf-8');
    const records = parseObservationMarkdown(content);
    return { file: f, records };
  });
}

/**
 * Run backward consolidation across observations.
 * 
 * For each newer observation, check all older observations for knowledge updates.
 * When found, mark the older one as superseded.
 */
export function reweave(options: ReweaveOptions): ReweaveResult {
  const { vaultPath, since, dryRun = false, similarityThreshold = 0.3 } = options;

  // Load ALL observations (we need old ones to compare against)
  const allObsFiles = loadObservations(vaultPath);
  
  // Determine which observations are "new" (to check backward from)
  const newObsFiles = since
    ? allObsFiles.filter(f => f.file.date >= since)
    : allObsFiles;

  // All observations older than the newest in the "new" set
  const allRecordsWithFile: Array<{
    record: ParsedObservationRecord;
    file: ObservationFileEntry;
    lineIndex: number;
  }> = [];

  for (const { file, records } of allObsFiles) {
    for (let i = 0; i < records.length; i++) {
      allRecordsWithFile.push({ record: records[i], file, lineIndex: i });
    }
  }

  // Sort by date ascending
  allRecordsWithFile.sort((a, b) => a.record.date.localeCompare(b.record.date));

  const supersessions: SupersessionRecord[] = [];
  const detectedAt = new Date().toISOString().slice(0, 10);

  // For each new observation, scan older observations for updates
  for (const { file: newFile, records: newRecords } of newObsFiles) {
    for (const newRec of newRecords) {
      // Skip already-superseded observations
      if (isSuperseded(newRec.rawLine)) continue;

      // Check against older observations
      for (const { record: oldRec, file: oldFile } of allRecordsWithFile) {
        // Only compare older observations
        if (oldRec.date >= newRec.date && oldFile.path === newFile.path) continue;
        if (oldRec.date > newRec.date) continue;
        
        // Skip already-superseded
        if (isSuperseded(oldRec.rawLine)) continue;

        const { isUpdate, reason } = isKnowledgeUpdate(oldRec, newRec, similarityThreshold);
        if (isUpdate) {
          supersessions.push({
            oldObservation: oldRec,
            newObservation: newRec,
            oldFile: oldFile.path,
            newFile: newFile.path,
            reason,
            detectedAt,
          });
        }
      }
    }
  }

  // Apply supersessions (mark old observations)
  if (!dryRun && supersessions.length > 0) {
    applySupersessions(supersessions, detectedAt);
  }

  return {
    filesScanned: allObsFiles.length,
    observationsChecked: allRecordsWithFile.length,
    supersessions,
    dryRun,
  };
}

/**
 * Apply supersession markers to observation files.
 * Groups by file to minimize I/O.
 */
function applySupersessions(supersessions: SupersessionRecord[], detectedAt: string): void {
  // Group by old file
  const byFile = new Map<string, SupersessionRecord[]>();
  for (const s of supersessions) {
    const existing = byFile.get(s.oldFile) ?? [];
    existing.push(s);
    byFile.set(s.oldFile, existing);
  }

  for (const [filePath, records] of byFile) {
    let content = fs.readFileSync(filePath, 'utf-8');
    
    for (const s of records) {
      const oldLine = s.oldObservation.rawLine;
      if (content.includes(oldLine) && !isSuperseded(oldLine)) {
        const marker = makeSupersededMarker(s.newObservation.date, detectedAt);
        content = content.replace(oldLine, oldLine + marker);
      }
    }

    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Search integration — filter superseded observations
// ---------------------------------------------------------------------------

/**
 * Filter search results to prefer latest versions of superseded observations.
 * When multiple observations cover the same entity, only keep the newest.
 * 
 * This is called from the search pipeline to boost knowledge update accuracy.
 */
export function filterSuperseded(lines: string[]): string[] {
  return lines.filter(line => !isSuperseded(line));
}

/**
 * Given observation markdown content, return only non-superseded lines.
 * Preserves date headings and structure.
 */
export function stripSupersededObservations(markdown: string): string {
  const lines = markdown.split('\n');
  const result: string[] = [];
  
  for (const line of lines) {
    // Always keep date headings and blank lines
    if (DATE_HEADING_RE.test(line) || line.trim() === '') {
      result.push(line);
      continue;
    }
    // Skip superseded observation lines
    if (isSuperseded(line)) continue;
    result.push(line);
  }

  // Clean up consecutive blank lines
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
