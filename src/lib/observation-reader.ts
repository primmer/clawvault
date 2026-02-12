import * as fs from 'fs';
import * as path from 'path';

export type ObservationPriority = '🔴' | '🟡' | '🟢';

export interface ParsedObservationLine {
  priority: string;
  content: string;
  date: string;
}

const DATE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
const OBSERVATION_LINE_RE = /^(🔴|🟡|🟢)\s+(\d{2}:\d{2})?\s*(.+)$/u;

const PRIORITY_RANK: Record<ObservationPriority, number> = {
  '🔴': 1,
  '🟡': 2,
  '🟢': 3
};

export function readObservations(vaultPath: string, days: number = 7): string {
  const resolvedVaultPath = path.resolve(vaultPath);
  const observationsDir = path.join(resolvedVaultPath, 'observations');
  if (!fs.existsSync(observationsDir)) {
    return '';
  }

  const normalizedDays = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  if (normalizedDays === 0) {
    return '';
  }

  const files = fs.readdirSync(observationsDir)
    .filter((name) => name.endsWith('.md'))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, normalizedDays);

  if (files.length === 0) {
    return '';
  }

  return files
    .map((name) => fs.readFileSync(path.join(observationsDir, name), 'utf-8').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function parseObservationLines(markdown: string): ParsedObservationLine[] {
  const results: ParsedObservationLine[] = [];
  let currentDate = '';

  for (const line of markdown.split(/\r?\n/)) {
    const dateMatch = line.match(DATE_HEADING_RE);
    if (dateMatch) {
      currentDate = dateMatch[1];
      continue;
    }

    const observationMatch = line.match(OBSERVATION_LINE_RE);
    if (!observationMatch) {
      continue;
    }

    const time = observationMatch[2]?.trim();
    const content = observationMatch[3].trim();
    const withTime = time ? `${time} ${content}` : content;

    results.push({
      priority: observationMatch[1],
      content: withTime,
      date: currentDate
    });
  }

  return results;
}

export function filterByPriority(observations: string, minPriority: ObservationPriority): string {
  const threshold = PRIORITY_RANK[minPriority];
  const grouped = new Map<string, Array<{ priority: string; content: string }>>();
  const filtered = parseObservationLines(observations)
    .filter((line) => {
      const rank = PRIORITY_RANK[line.priority as ObservationPriority];
      return rank <= threshold;
    });

  for (const line of filtered) {
    const bucket = grouped.get(line.date) ?? [];
    bucket.push({ priority: line.priority, content: line.content });
    grouped.set(line.date, bucket);
  }

  const chunks: string[] = [];
  for (const [date, lines] of grouped.entries()) {
    if (date) {
      chunks.push(`## ${date}`);
      chunks.push('');
    }
    for (const line of lines) {
      chunks.push(`${line.priority} ${line.content}`);
    }
    chunks.push('');
  }

  return chunks.join('\n').trim();
}
