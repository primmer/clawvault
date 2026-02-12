import {
  ClawVault
} from "./chunk-3HFB7EMU.js";

// src/commands/context.ts
import * as path2 from "path";

// src/lib/observation-reader.ts
import * as fs from "fs";
import * as path from "path";
var DATE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/;
var OBSERVATION_LINE_RE = /^(🔴|🟡|🟢)\s+(\d{2}:\d{2})?\s*(.+)$/u;
function readObservations(vaultPath, days = 7) {
  const resolvedVaultPath = path.resolve(vaultPath);
  const observationsDir = path.join(resolvedVaultPath, "observations");
  if (!fs.existsSync(observationsDir)) {
    return "";
  }
  const normalizedDays = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  if (normalizedDays === 0) {
    return "";
  }
  const files = fs.readdirSync(observationsDir).filter((name) => name.endsWith(".md")).sort((a, b) => b.localeCompare(a)).slice(0, normalizedDays);
  if (files.length === 0) {
    return "";
  }
  return files.map((name) => fs.readFileSync(path.join(observationsDir, name), "utf-8").trim()).filter(Boolean).join("\n\n").trim();
}
function parseObservationLines(markdown) {
  const results = [];
  let currentDate = "";
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

// src/lib/token-counter.ts
function estimateTokens(text) {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}
function fitWithinBudget(items, budget) {
  if (!Number.isFinite(budget) || budget <= 0) {
    return [];
  }
  const sorted = items.map((item, index) => ({ ...item, index })).sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.index - b.index;
  });
  let remaining = Math.floor(budget);
  const fitted = [];
  for (const item of sorted) {
    if (!item.text.trim()) {
      continue;
    }
    const cost = estimateTokens(item.text);
    if (cost <= remaining) {
      fitted.push({ text: item.text, source: item.source });
      remaining -= cost;
    }
    if (remaining <= 0) {
      break;
    }
  }
  return fitted;
}

// src/commands/context.ts
var DEFAULT_LIMIT = 5;
var MAX_SNIPPET_LENGTH = 320;
var OBSERVATION_LOOKBACK_DAYS = 7;
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
  "your"
]);
function formatRelativeAge(date, now = Date.now()) {
  const ageMs = Math.max(0, now - date.getTime());
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1e3));
  if (days === 0) return "today";
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
function normalizeSnippet(result) {
  const source = (result.snippet || result.document.content || "").trim();
  if (!source) return "No snippet available.";
  return source.replace(/\s+/g, " ").slice(0, MAX_SNIPPET_LENGTH);
}
function formatContextMarkdown(task, entries) {
  let output = `## Relevant Context for: ${task}

`;
  if (entries.length === 0) {
    output += "_No relevant context found._\n";
    return output;
  }
  for (const entry of entries) {
    output += `### ${entry.title} (${entry.source}, score: ${entry.score.toFixed(2)}, ${entry.age})
`;
    output += `${entry.snippet}

`;
  }
  return output.trimEnd();
}
function extractKeywords(text) {
  const raw = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const seen = /* @__PURE__ */ new Set();
  const keywords = [];
  for (const token of raw) {
    if (token.length < 2 || STOP_WORDS.has(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    keywords.push(token);
  }
  return keywords;
}
function computeKeywordOverlapScore(queryKeywords, text) {
  if (queryKeywords.length === 0) {
    return 1;
  }
  const haystack = new Set(extractKeywords(text));
  let matches = 0;
  for (const keyword of queryKeywords) {
    if (haystack.has(keyword)) {
      matches += 1;
    }
  }
  if (matches === 0) {
    return 0.1;
  }
  return matches / queryKeywords.length;
}
function estimateSnippet(source) {
  const normalized = source.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "No snippet available.";
  }
  return normalized.slice(0, MAX_SNIPPET_LENGTH);
}
function parseIsoDate(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
  }
  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isNaN(time)) {
      return value.toISOString().slice(0, 10);
    }
  }
  return null;
}
function asDate(value, fallback = /* @__PURE__ */ new Date(0)) {
  if (!value) {
    return fallback;
  }
  const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
function observationPriorityToRank(priority) {
  if (priority === "\u{1F534}") return 1;
  if (priority === "\u{1F7E1}") return 4;
  return 5;
}
function isLikelyDailyNote(document) {
  const normalizedPath = document.path.split(path2.sep).join("/").toLowerCase();
  if (normalizedPath.includes("/daily/")) {
    return true;
  }
  const category = document.category.toLowerCase();
  if (category.includes("daily")) {
    return true;
  }
  const type = typeof document.frontmatter.type === "string" ? document.frontmatter.type.toLowerCase() : "";
  return type === "daily";
}
function findDailyDate(document, targetDates) {
  const frontmatterDate = parseIsoDate(document.frontmatter.date);
  const titleDate = parseIsoDate(document.title);
  const fileDate = parseIsoDate(path2.basename(document.path, ".md"));
  const candidates = [frontmatterDate, titleDate, fileDate].filter((value) => Boolean(value));
  for (const candidate of candidates) {
    if (!targetDates.has(candidate)) {
      continue;
    }
    if (isLikelyDailyNote(document) || titleDate === candidate || fileDate === candidate) {
      return candidate;
    }
  }
  return null;
}
function getTargetDailyDates(now = /* @__PURE__ */ new Date()) {
  const today = now.toISOString().slice(0, 10);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  return [today, yesterday];
}
async function buildDailyContextItems(vault) {
  const allDocuments = await vault.list();
  const targetDates = getTargetDailyDates();
  const targetDateSet = new Set(targetDates);
  const byDate = /* @__PURE__ */ new Map();
  for (const document of allDocuments) {
    const dailyDate = findDailyDate(document, targetDateSet);
    if (!dailyDate) {
      continue;
    }
    const existing = byDate.get(dailyDate);
    if (!existing || document.modified.getTime() > existing.modified.getTime()) {
      byDate.set(dailyDate, document);
    }
  }
  const items = [];
  for (const date of targetDates) {
    const document = byDate.get(date);
    if (!document) {
      continue;
    }
    const relativePath = path2.relative(vault.getPath(), document.path).split(path2.sep).join("/");
    const snippet = estimateSnippet(document.content);
    items.push({
      priority: 2,
      entry: {
        title: `Daily note ${date}`,
        path: relativePath,
        category: document.category,
        score: 0.9,
        snippet,
        modified: document.modified.toISOString(),
        age: formatRelativeAge(document.modified),
        source: "daily-note"
      }
    });
  }
  return items;
}
function buildObservationContextItems(vaultPath, queryKeywords) {
  const observationMarkdown = readObservations(vaultPath, OBSERVATION_LOOKBACK_DAYS);
  const parsed = parseObservationLines(observationMarkdown);
  const items = [];
  for (const observation of parsed) {
    const priority = observationPriorityToRank(observation.priority);
    const modifiedDate = asDate(observation.date, /* @__PURE__ */ new Date());
    const date = observation.date || modifiedDate.toISOString().slice(0, 10);
    const snippet = estimateSnippet(observation.content);
    items.push({
      priority,
      entry: {
        title: `${observation.priority} observation (${date})`,
        path: `observations/${date}.md`,
        category: "observations",
        score: computeKeywordOverlapScore(queryKeywords, observation.content),
        snippet,
        modified: modifiedDate.toISOString(),
        age: formatRelativeAge(modifiedDate),
        source: "observation"
      }
    });
  }
  return items;
}
function buildSearchContextItems(vault, results) {
  return results.map((result) => {
    const relativePath = path2.relative(vault.getPath(), result.document.path).split(path2.sep).join("/");
    const entry = {
      title: result.document.title,
      path: relativePath,
      category: result.document.category,
      score: result.score,
      snippet: normalizeSnippet(result),
      modified: result.document.modified.toISOString(),
      age: formatRelativeAge(result.document.modified),
      source: "search"
    };
    return {
      priority: 3,
      entry
    };
  });
}
function renderEntryBlock(entry) {
  return `### ${entry.title} (${entry.source}, score: ${entry.score.toFixed(2)}, ${entry.age})
${entry.snippet}

`;
}
function truncateToBudget(text, budget) {
  if (!Number.isFinite(budget) || budget <= 0) {
    return "";
  }
  const maxChars = Math.max(0, Math.floor(budget) * 4);
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars).trimEnd();
}
function applyTokenBudget(items, task, budget) {
  const fullContext = items.map((item) => item.entry);
  const fullMarkdown = formatContextMarkdown(task, fullContext);
  if (budget === void 0) {
    return { context: fullContext, markdown: fullMarkdown };
  }
  const normalizedBudget = Math.max(1, Math.floor(budget));
  if (estimateTokens(fullMarkdown) <= normalizedBudget) {
    return { context: fullContext, markdown: fullMarkdown };
  }
  const header = `## Relevant Context for: ${task}

`;
  const headerCost = estimateTokens(header);
  if (headerCost >= normalizedBudget) {
    return {
      context: [],
      markdown: truncateToBudget(header.trimEnd(), normalizedBudget)
    };
  }
  const fitted = fitWithinBudget(
    items.map((item, index) => ({
      text: renderEntryBlock(item.entry),
      priority: item.priority,
      source: String(index)
    })),
    normalizedBudget - headerCost
  );
  const selectedEntries = fitted.map((item) => {
    const index = Number.parseInt(item.source, 10);
    return Number.isNaN(index) ? null : items[index]?.entry ?? null;
  }).filter((entry) => Boolean(entry));
  const markdown = truncateToBudget(formatContextMarkdown(task, selectedEntries), normalizedBudget);
  return {
    context: selectedEntries,
    markdown
  };
}
async function buildContext(task, options) {
  const normalizedTask = task.trim();
  if (!normalizedTask) {
    throw new Error("Task description is required.");
  }
  const vault = new ClawVault(path2.resolve(options.vaultPath));
  await vault.load();
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const recent = options.recent ?? true;
  const includeObservations = options.includeObservations ?? true;
  const queryKeywords = extractKeywords(normalizedTask);
  const searchResults = await vault.vsearch(normalizedTask, {
    limit,
    temporalBoost: recent
  });
  const searchItems = buildSearchContextItems(vault, searchResults);
  const dailyItems = await buildDailyContextItems(vault);
  const observationItems = includeObservations ? buildObservationContextItems(vault.getPath(), queryKeywords) : [];
  const byScoreDesc = (left, right) => right.entry.score - left.entry.score;
  const redObservations = observationItems.filter((item) => item.priority === 1).sort(byScoreDesc);
  const yellowObservations = observationItems.filter((item) => item.priority === 4).sort(byScoreDesc);
  const greenObservations = observationItems.filter((item) => item.priority === 5).sort(byScoreDesc);
  const sortedDailyItems = [...dailyItems].sort(byScoreDesc);
  const sortedSearchItems = [...searchItems].sort(byScoreDesc);
  const ordered = [
    ...redObservations,
    ...sortedDailyItems,
    ...sortedSearchItems,
    ...yellowObservations,
    ...greenObservations
  ];
  const { context, markdown } = applyTokenBudget(ordered, normalizedTask, options.budget);
  return {
    task: normalizedTask,
    generated: (/* @__PURE__ */ new Date()).toISOString(),
    context,
    markdown
  };
}
async function contextCommand(task, options) {
  const result = await buildContext(task, options);
  const format = options.format ?? "markdown";
  if (format === "json") {
    console.log(JSON.stringify({
      task: result.task,
      generated: result.generated,
      count: result.context.length,
      context: result.context
    }, null, 2));
    return;
  }
  console.log(result.markdown);
}
function parsePositiveInteger(raw, label) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return parsed;
}
function registerContextCommand(program) {
  program.command("context <task>").description("Generate task-relevant context for prompt injection").option("-n, --limit <n>", "Max results", "5").option("--format <format>", "Output format (markdown|json)", "markdown").option("--recent", "Boost recent documents (enabled by default)", true).option("--include-observations", "Include observation memories in output", true).option("--budget <number>", "Optional token budget for assembled context").option("-v, --vault <path>", "Vault path").action(async (task, rawOptions) => {
    const format = rawOptions.format === "json" ? "json" : "markdown";
    const budget = rawOptions.budget ? parsePositiveInteger(rawOptions.budget, "budget") : void 0;
    const limit = parsePositiveInteger(rawOptions.limit, "limit");
    const vaultPath = rawOptions.vault ?? process.env.CLAWVAULT_PATH ?? process.cwd();
    await contextCommand(task, {
      vaultPath,
      limit,
      format,
      recent: rawOptions.recent ?? true,
      includeObservations: rawOptions.includeObservations ?? true,
      budget
    });
  });
}

export {
  formatContextMarkdown,
  buildContext,
  contextCommand,
  registerContextCommand
};
