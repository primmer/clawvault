import * as fs from 'fs';
import * as path from 'path';
import { ClawVault } from '../lib/vault.js';
import type { SessionRecap } from '../types.js';
import { clearDirtyFlag } from './checkpoint.js';
import { recover, type RecoveryInfo } from './recover.js';

export interface WakeOptions {
  vaultPath: string;
  handoffLimit?: number;
  brief?: boolean;
}

export interface WakeResult {
  recovery: RecoveryInfo;
  recap: SessionRecap;
  recapMarkdown: string;
  summary: string;
  observations: string;
}

const DEFAULT_HANDOFF_LIMIT = 3;
const OBSERVATION_HIGHLIGHT_RE = /^(🔴|🟡)\s+(.+)$/u;

interface ObservationHighlight {
  date: string;
  priority: '🔴' | '🟡';
  text: string;
}

function formatSummaryItems(items: string[], maxItems: number = 2): string {
  const cleaned = items.map(item => item.trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  if (cleaned.length <= maxItems) return cleaned.join(', ');
  return `${cleaned.slice(0, maxItems).join(', ')} +${cleaned.length - maxItems} more`;
}

export function buildWakeSummary(recovery: RecoveryInfo, recap: SessionRecap): string {
  let workSummary = '';
  if (recovery.checkpoint?.workingOn) {
    workSummary = recovery.checkpoint.workingOn;
  } else {
    const latestHandoff = recap.recentHandoffs[0];
    if (latestHandoff?.workingOn?.length) {
      workSummary = formatSummaryItems(latestHandoff.workingOn);
    } else if (recap.activeProjects.length > 0) {
      workSummary = formatSummaryItems(recap.activeProjects);
    }
  }

  return workSummary || 'No recent work summary found.';
}

function formatDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function readRecentObservationHighlights(vaultPath: string): ObservationHighlight[] {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const dateKeys = [formatDateKey(now), formatDateKey(yesterday)];
  const highlights: ObservationHighlight[] = [];

  for (const dateKey of dateKeys) {
    const filePath = path.join(vaultPath, 'observations', `${dateKey}.md`);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');

    for (const line of content.split(/\r?\n/)) {
      const match = line.trim().match(OBSERVATION_HIGHLIGHT_RE);
      if (!match?.[2]) continue;
      highlights.push({
        date: dateKey,
        priority: match[1] as '🔴' | '🟡',
        text: match[2].trim()
      });
    }
  }

  return highlights;
}

function formatRecentObservations(highlights: ObservationHighlight[]): string {
  if (highlights.length === 0) {
    return '_No critical or notable observations from today or yesterday._';
  }

  const byDate = new Map<string, ObservationHighlight[]>();
  for (const item of highlights) {
    const bucket = byDate.get(item.date) ?? [];
    bucket.push(item);
    byDate.set(item.date, bucket);
  }

  const lines: string[] = [];
  for (const [date, items] of byDate.entries()) {
    lines.push(`### ${date}`);
    for (const item of items) {
      lines.push(`- ${item.priority} ${item.text}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

export async function wake(options: WakeOptions): Promise<WakeResult> {
  const vaultPath = path.resolve(options.vaultPath);
  const recovery = await recover(vaultPath, { clearFlag: true });
  await clearDirtyFlag(vaultPath);

  const vault = new ClawVault(vaultPath);
  await vault.load();
  const recap = await vault.generateRecap({
    handoffLimit: options.handoffLimit ?? DEFAULT_HANDOFF_LIMIT,
    brief: options.brief ?? true
  });
  const highlights = readRecentObservationHighlights(vaultPath);
  const observations = formatRecentObservations(highlights);
  const highlightSummaryItems = highlights.map((item) => `${item.priority} ${item.text}`);
  const wakeSummary = formatSummaryItems(highlightSummaryItems);
  const baseSummary = buildWakeSummary(recovery, recap);
  const summary = wakeSummary ? `${baseSummary} | ${wakeSummary}` : baseSummary;
  const baseRecapMarkdown = vault.formatRecap(recap, { brief: options.brief ?? true }).trimEnd();
  const recapMarkdown = `${baseRecapMarkdown}\n\n## Recent Observations\n${observations}`;

  return {
    recovery,
    recap,
    recapMarkdown,
    summary,
    observations
  };
}
