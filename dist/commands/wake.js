import {
  recover
} from "../chunk-MILVYUPK.js";
import {
  clearDirtyFlag
} from "../chunk-MZZJLQNQ.js";
import "../chunk-7ZRP733D.js";
import {
  ClawVault
} from "../chunk-3HFB7EMU.js";
import "../chunk-MIIXBNO3.js";

// src/commands/wake.ts
import * as fs from "fs";
import * as path from "path";
var DEFAULT_HANDOFF_LIMIT = 3;
var OBSERVATION_HIGHLIGHT_RE = /^(🔴|🟡)\s+(.+)$/u;
var MAX_WAKE_RED_OBSERVATIONS = 20;
var MAX_WAKE_YELLOW_OBSERVATIONS = 10;
var MAX_WAKE_OUTPUT_LINES = 100;
function formatSummaryItems(items, maxItems = 2) {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  if (cleaned.length <= maxItems) return cleaned.join(", ");
  return `${cleaned.slice(0, maxItems).join(", ")} +${cleaned.length - maxItems} more`;
}
function buildWakeSummary(recovery, recap) {
  let workSummary = "";
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
  return workSummary || "No recent work summary found.";
}
function formatDateKey(date) {
  return date.toISOString().split("T")[0];
}
function readRecentObservationHighlights(vaultPath) {
  const now = /* @__PURE__ */ new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const dateKeys = [formatDateKey(now), formatDateKey(yesterday)];
  const highlights = [];
  for (const dateKey of dateKeys) {
    const filePath = path.join(vaultPath, "observations", `${dateKey}.md`);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.trim().match(OBSERVATION_HIGHLIGHT_RE);
      if (!match?.[2]) continue;
      highlights.push({
        date: dateKey,
        priority: match[1],
        text: match[2].trim()
      });
    }
  }
  return highlights;
}
function timeFromObservationText(text) {
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)\b/);
  if (!match) {
    return -1;
  }
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}
function compareByRecency(left, right) {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }
  return timeFromObservationText(right.text) - timeFromObservationText(left.text);
}
function formatRecentObservations(highlights) {
  if (highlights.length === 0) {
    return "_No critical or notable observations from today or yesterday._";
  }
  const sorted = [...highlights].sort(compareByRecency);
  const red = sorted.filter((item) => item.priority === "\u{1F534}").slice(0, MAX_WAKE_RED_OBSERVATIONS);
  const yellow = sorted.filter((item) => item.priority === "\u{1F7E1}").slice(0, MAX_WAKE_YELLOW_OBSERVATIONS);
  const visible = [...red, ...yellow].sort(compareByRecency);
  const omittedCount = Math.max(0, highlights.length - visible.length);
  const byDate = /* @__PURE__ */ new Map();
  for (const item of visible) {
    const bucket = byDate.get(item.date) ?? [];
    bucket.push(item);
    byDate.set(item.date, bucket);
  }
  const lines = [];
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
      lines.push("");
    }
  }
  if (omittedCount > 0) {
    lines.push(`... and ${omittedCount} more observations (use \`clawvault context\` to query)`);
  }
  return lines.join("\n").trim();
}
async function wake(options) {
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
  const recapMarkdown = `${baseRecapMarkdown}

## Recent Observations
${observations}`;
  return {
    recovery,
    recap,
    recapMarkdown,
    summary,
    observations
  };
}
export {
  buildWakeSummary,
  wake
};
