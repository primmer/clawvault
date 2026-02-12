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
function formatRecentObservations(highlights) {
  if (highlights.length === 0) {
    return "_No critical or notable observations from today or yesterday._";
  }
  const byDate = /* @__PURE__ */ new Map();
  for (const item of highlights) {
    const bucket = byDate.get(item.date) ?? [];
    bucket.push(item);
    byDate.set(item.date, bucket);
  }
  const lines = [];
  for (const [date, items] of byDate.entries()) {
    lines.push(`### ${date}`);
    for (const item of items) {
      lines.push(`- ${item.priority} ${item.text}`);
    }
    lines.push("");
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
