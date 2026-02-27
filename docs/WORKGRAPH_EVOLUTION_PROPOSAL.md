# Workgraph Evolution Proposal

Concise, production-focused improvements for the workgraph system. Prioritized for impact and shippability.

---

## 1. Ledger Index for Fast Coordination Queries

**Rationale:** `ledger.currentOwner()`, `allClaims()`, and `historyOf()` scan the full JSONL on every call. As vaults grow (hundreds of threads, thousands of ledger entries), coordination checks become O(n) and slow down claim/release/done flows. Agents polling for open work will hit this repeatedly.

**Implementation shape:**
- Add `.clawvault/ledger-index.json` — a compact snapshot: `{ claims: Record<path, owner>, lastEntryTs: string, version: number }`.
- On `ledger.append()`, if op is `claim`/`release`/`done`/`cancel`, update the index synchronously (read-modify-write).
- New helpers: `ledger.claimsFromIndex(vaultPath)` — returns cached claims without scanning; falls back to full scan if index missing or stale.
- Optional: `ledger.rebuildIndex(vaultPath)` for repair. Index is derived state; ledger remains source of truth.

**Risk:** Low. Index is optional; existing code paths unchanged. Worst case: index corruption → fallback to full scan.

---

## 2. Anacortex-Memory Primitive Family

**Rationale:** Hippocampal-cortical consolidation: episodic memory (recent, session-bound) vs cortical memory (consolidated, semantic, long-term). MemGPT/HiMem-style hierarchy — agents need a clear path from "what just happened" to "what we learned." Current `lesson` and `fact` are flat; no explicit promotion flow.

**Implementation shape:**
- **New built-in type: `episode`** — directory `episodes/`. Fields: `title`, `session_id`, `created`, `raw_refs` (list of vault paths that informed this episode), `body` (freeform). Episodes are created by observer/reflector when compressing session activity.
- **New built-in type: `consolidation`** — directory `consolidations/`. Fields: `title`, `source_episodes` (refs to episodes), `summary` (semantic distillation), `promoted_at`, `confidence`, `context_refs`. Created when an agent or weekly job promotes episodes into long-term memory.
- **Ledger op: `promote`** — log when episode(s) → consolidation. Enables audit trail of consolidation.
- **Registry:** Add both to `BUILT_IN_TYPES` in `registry.ts`. Observer can write episodes; a `clawvault consolidate` command (or hook) can batch-promote.

**Risk:** Medium. New types and directories; need to wire observer output into episodes. Backward compatible — existing lessons/facts unchanged.

---

## 3. Command-Center UX in Obsidian

**Rationale:** Users and agents need a single "mission control" view: open threads, who owns what, recent activity, quick actions. Obsidian is the primary UX; the dashboard is separate. A Command Center note gives a human-readable, always-fresh hub inside the vault.

**Implementation shape:**
- **New command: `clawvault workgraph command-center`** — generates or updates `Command Center.md` (or configurable path) in vault root.
- **Content:** Markdown with:
  - **Open threads** — table: path, title, priority, (owner if claimed)
  - **Active claims** — who → what
  - **Recent ledger** — last 10 entries (op, actor, target, time)
  - **Quick links** — `[[threads/...]]` for open threads
- **Obsidian Bases integration:** If `threads/` exists, add a `command-center.base` (or extend existing) with filters: `file.inFolder("threads")`, `status != "done"`, `status != "cancelled"`. Group by `status` or `owner`.
- **Template:** `clawvault init` / `setup` can seed `Command Center.md` with a template that uses Dataview queries (if user has Dataview) or static structure. The `command-center` command overwrites the dynamic sections.
- **Refresh:** Run on `clawvault wake`, or via cron. Option: `--watch` to regenerate on ledger changes (debounced).

**Risk:** Low. New command; no changes to core workgraph. File is generated; users can edit static parts, dynamic parts get overwritten.

---

## 4. Space-Scoped Thread Filtering

**Rationale:** `space` exists with `thread_refs`, but threads don't reference their space. Filtering "threads in space X" requires scanning all threads and matching refs. Agents working in a space need `thread list --space <slug>` and programmatic `store.threadsInSpace()`.

**Implementation shape:**
- **Thread field: `space`** (type `ref`, optional) — wiki-link to the space file, e.g. `[[spaces/backend.md]]`.
- **Store helper:** `store.threadsInSpace(vaultPath, spacePath)` — filter `list('thread')` by `fields.space === spacePath` or normalized ref.
- **CLI:** `clawvault thread list --space spaces/backend` — filter by space.
- **createThread:** Add optional `space` to opts; set `context_refs` to include space if not already.
- **Bidirectional sync:** When adding a thread to a space via `space.thread_refs`, optionally update the thread's `space` field (or document that users/agents should set both).

**Risk:** Low. Additive; existing threads without `space` still work. `thread_refs` and `space` can diverge — document the convention.

---

## 5. Workgraph-Aware Context Retrieval

**Rationale:** `clawvault context` blends semantic search + graph neighbors but does not include workgraph state. Agents retrieving context for a task have no visibility into: what threads are open, what's claimed, recent coordination events. They may suggest work that's already in progress or miss blocking dependencies.

**Implementation shape:**
- **Context command enhancement:** Add an optional `--workgraph` flag (default: true when vault has workgraph data).
- **Blend:** When `--workgraph` is set, prepend a "Workgraph state" section to the context output:
  - Open threads (title, path, priority)
  - Active claims (owner → path)
  - Blocked threads and their `blocked_by`
  - Last 5 ledger entries (op, actor, target)
- **Format:** Structured text or JSON block that the agent can parse. E.g. `## Workgraph\n\nOpen: ...\nClaims: ...\nRecent: ...`
- **Implementation:** In `context.ts` (or equivalent), call `store.openThreads()`, `ledger.allClaims()`, `store.blockedThreads()`, `ledger.recent()` and inject into the blended output.

**Risk:** Low. Additive; increases context size slightly. Agents that ignore it are unaffected. Can add `--no-workgraph` to disable.

---

## Summary Table

| # | Improvement              | Rationale                          | Risk  |
|---|--------------------------|------------------------------------|-------|
| 1 | Ledger index             | O(1) claims; scales to large vaults| Low   |
| 2 | Anacortex-memory family  | Episodic → cortical consolidation | Medium|
| 3 | Command-center UX        | Single hub for threads/claims in Obsidian | Low   |
| 4 | Space-scoped threads     | Filter threads by space; clearer ownership | Low   |
| 5 | Workgraph-aware context  | Agents see coordination state in context | Low   |

---

## Suggested Implementation Order

1. **#4 Space-scoped threads** — Smallest change, immediate filtering value.
2. **#5 Workgraph-aware context** — High impact for agent coordination; no new primitives.
3. **#3 Command-center UX** — Improves human and agent UX; builds on existing workgraph.
4. **#1 Ledger index** — Do when ledger size becomes a bottleneck (or proactively for large deployments).
5. **#2 Anacortex-memory** — Requires observer integration; do after episodes/consolidations are designed with real observer output in mind.
