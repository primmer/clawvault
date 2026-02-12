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
  /** Skip LLM executive summary generation (useful for tests/offline) */
  noSummary?: boolean;
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
const MAX_WAKE_RED_OBSERVATIONS = 20;
const MAX_WAKE_YELLOW_OBSERVATIONS = 10;
const MAX_WAKE_OUTPUT_LINES = 100;

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
  const highlights: ObservationHighlight[] = [];

  // Read up to 7 days with temporal decay:
  // Day 0 (today): all 🔴 and 🟡
  // Day 1 (yesterday): all 🔴, top 5 🟡
  // Day 2-3: 🔴 only
  // Day 4-6: 🔴 only, max 3
  for (let daysAgo = 0; daysAgo < 7; daysAgo++) {
    const date = new Date(now);
    date.setDate(now.getDate() - daysAgo);
    const dateKey = formatDateKey(date);
    const filePath = path.join(vaultPath, 'observations', `${dateKey}.md`);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');

    const dayRed: ObservationHighlight[] = [];
    const dayYellow: ObservationHighlight[] = [];

    for (const line of content.split(/\r?\n/)) {
      const match = line.trim().match(OBSERVATION_HIGHLIGHT_RE);
      if (!match?.[2]) continue;
      const item: ObservationHighlight = {
        date: dateKey,
        priority: match[1] as '🔴' | '🟡',
        text: match[2].trim()
      };
      if (item.priority === '🔴') dayRed.push(item);
      else dayYellow.push(item);
    }

    // Apply temporal decay
    if (daysAgo === 0) {
      highlights.push(...dayRed, ...dayYellow);
    } else if (daysAgo === 1) {
      highlights.push(...dayRed, ...dayYellow.slice(0, 5));
    } else if (daysAgo <= 3) {
      highlights.push(...dayRed);
    } else {
      highlights.push(...dayRed.slice(0, 3));
    }
  }

  return highlights;
}

function timeFromObservationText(text: string): number {
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)\b/);
  if (!match) {
    return -1;
  }
  return (Number.parseInt(match[1], 10) * 60) + Number.parseInt(match[2], 10);
}

function compareByRecency(left: ObservationHighlight, right: ObservationHighlight): number {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }
  return timeFromObservationText(right.text) - timeFromObservationText(left.text);
}

function formatRecentObservations(highlights: ObservationHighlight[]): string {
  if (highlights.length === 0) {
    return '_No critical or notable observations from today or yesterday._';
  }

  const sorted = [...highlights].sort(compareByRecency);
  const red = sorted.filter((item) => item.priority === '🔴').slice(0, MAX_WAKE_RED_OBSERVATIONS);
  const yellow = sorted.filter((item) => item.priority === '🟡').slice(0, MAX_WAKE_YELLOW_OBSERVATIONS);
  const visible = [...red, ...yellow].sort(compareByRecency);
  const omittedCount = Math.max(0, highlights.length - visible.length);

  const byDate = new Map<string, ObservationHighlight[]>();
  for (const item of visible) {
    const bucket = byDate.get(item.date) ?? [];
    bucket.push(item);
    byDate.set(item.date, bucket);
  }

  const lines: string[] = [];
  const bodyLineBudget = Math.max(1, MAX_WAKE_OUTPUT_LINES - (omittedCount > 0 ? 1 : 0));

  for (const [date, items] of byDate.entries()) {
    if (lines.length >= bodyLineBudget) {
      break;
    }

    lines.push(`### ${date}`);
    for (const item of items) {
      if (lines.length >= bodyLineBudget) {
        break;
      }
      lines.push(`- ${item.priority} ${item.text}`);
    }
    if (lines.length < bodyLineBudget) {
      lines.push('');
    }
  }

  if (omittedCount > 0) {
    lines.push(`... and ${omittedCount} more observations (use \`clawvault context\` to query)`);
  }

  return lines.join('\n').trim();
}

async function generateExecutiveSummary(
  recovery: RecoveryInfo,
  recap: SessionRecap,
  highlights: ObservationHighlight[]
): Promise<string | null> {
  if (process.env.CLAWVAULT_NO_LLM || process.env.VITEST) return null;
  const apiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const redItems = highlights.filter(h => h.priority === '🔴').map(h => h.text).slice(0, 10);
  const yellowItems = highlights.filter(h => h.priority === '🟡').map(h => h.text).slice(0, 5);
  const projects = recap.activeProjects.slice(0, 8);
  const commitments = recap.pendingCommitments.slice(0, 5);
  const lastWork = recovery.checkpoint?.workingOn || recap.recentHandoffs[0]?.workingOn?.join(', ') || '';
  const blockers = recovery.checkpoint?.blocked || recap.recentHandoffs[0]?.blocked?.join(', ') || '';
  const nextSteps = recap.recentHandoffs[0]?.nextSteps?.join(', ') || '';

  const prompt = [
    'You are a chief of staff briefing an AI agent waking up for a new session.',
    'Write a 3-5 sentence executive summary answering: What matters RIGHT NOW?',
    'Be direct and specific. No headers, no bullets — just a tight paragraph.',
    'Mention the most urgent item first. Include deadlines if any.',
    '',
    `Last working on: ${lastWork || '(unknown)'}`,
    `Blockers: ${blockers || '(none)'}`,
    `Next steps: ${nextSteps || '(none)'}`,
    `Active projects (${projects.length}): ${projects.join(', ') || '(none)'}`,
    `Pending commitments: ${commitments.join(', ') || '(none)'}`,
    `Critical observations: ${redItems.join(' | ') || '(none)'}`,
    `Notable observations: ${yellowItems.join(' | ') || '(none)'}`,
    '',
    'Write the briefing now. Be concise.'
  ].join('\n');

  try {
    if (process.env.GEMINI_API_KEY) {
      const model = 'gemini-2.0-flash';
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 300 }
          })
        }
      );
      if (!resp.ok) return null;
      const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    }
    // Could add Anthropic/OpenAI fallbacks here, but Gemini Flash is cheap and fast
  } catch {
    return null;
  }
  return null;
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

  // Generate executive summary via LLM (best-effort, non-blocking)
  const execSummary = options.noSummary ? null : await generateExecutiveSummary(recovery, recap, highlights);

  const highlightSummaryItems = highlights.map((item) => `${item.priority} ${item.text}`);
  const wakeSummary = formatSummaryItems(highlightSummaryItems);
  const baseSummary = buildWakeSummary(recovery, recap);
  const fullBaseSummary = wakeSummary ? `${baseSummary} | ${wakeSummary}` : baseSummary;
  const summary = execSummary || fullBaseSummary;
  const baseRecapMarkdown = vault.formatRecap(recap, { brief: options.brief ?? true }).trimEnd();

  const execSection = execSummary ? `## 📋 Executive Summary\n\n${execSummary}\n\n` : '';
  const recapMarkdown = `${execSection}${baseRecapMarkdown}\n\n## Recent Observations\n${observations}`;

  return {
    recovery,
    recap,
    recapMarkdown,
    summary,
    observations
  };
}
