# Observational Memory (OM) Design

> Ledger-first compiler architecture for agent memory

**Status**: Design Document  
**Issue**: [#4 - Observational Memory ideas](https://github.com/Versatly/clawvault/issues/4)  
**Version**: v3.0 (ClawVault Plugin Architecture)

---

## Overview

Observational Memory (OM) is an architectural pattern for AI agent memory that treats **transcripts as the source of truth** and all memory artifacts as **compiled outputs**. This design eliminates direct agent writes to memory, ensuring determinism, consistency, and full replayability.

The core principle: **Agents talk. Observers decide what mattered. Compilers decide what becomes memory.**

---

## Design Principles

### 1. Ledger-First Architecture

All memory originates from raw session transcripts. The ledger is the canonical source of truth.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Ledger-First Data Flow                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Raw Transcripts (Source of Truth)                                         │
│   └── ledger/raw/<source>/YYYY-MM-DD-<session-id>.jsonl                    │
│                                                                             │
│           │                                                                 │
│           ▼                                                                 │
│                                                                             │
│   Compiled Observations (Daily, Hot)                                        │
│   └── observations/YYYY-MM-DD.md                                           │
│                                                                             │
│           │                                                                 │
│           ▼                                                                 │
│                                                                             │
│   Compiled Reflections (Weekly, Stable Patterns)                            │
│   └── reflections/YYYY-WNN.md                                              │
│                                                                             │
│           │                                                                 │
│           ▼                                                                 │
│                                                                             │
│   Compiled Views (Whitelist-Only, Rebuilt on Reflect)                       │
│   └── views/{now,context,summary}.md                                       │
│                                                                             │
│           │                                                                 │
│           ▼                                                                 │
│                                                                             │
│   Archive (Cold Storage, Never Deleted)                                     │
│   └── archive/observations/YYYY/MM/DD.md                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key constraints:**

- Observations, reflections, and views are **compiled artifacts** — no direct human or agent edits
- Full rebuild from raw transcripts is always possible via `clawvault rebuild`
- Archive is append-only; nothing is ever deleted, only moved to cold storage

### 2. Observation → Reflection → View Compiler Pipeline

The compiler pipeline transforms raw transcripts into progressively more refined memory artifacts.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Compiler Pipeline Stages                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Stage 1: OBSERVE (Daily)                                                  │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Input:  Raw session transcripts                                     │  │
│   │  Output: observations/YYYY-MM-DD.md                                  │  │
│   │  Trigger: End of session, cron.daily, manual                         │  │
│   │  Retention: 7 days active, then archived                             │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Stage 2: REFLECT (Weekly)                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Input:  Last N days of observations                                 │  │
│   │  Output: reflections/YYYY-WNN.md                                     │  │
│   │  Trigger: cron.weekly, manual                                        │  │
│   │  Process: Deduplicate claims, promote recurring patterns             │  │
│   │  Promotion: Repetition (≥3 occurrences) + Importance (scored)        │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Stage 3: COMPILE VIEWS (On Reflect)                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Input:  Reflections + active observations                           │  │
│   │  Output: views/{now,context,summary}.md                              │  │
│   │  Trigger: After reflect, manual                                      │  │
│   │  Constraint: Whitelist-only paths, no auto-creation                  │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Stage 4: ARCHIVE (Configurable Retention)                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Input:  Aged observations                                           │  │
│   │  Output: archive/observations/YYYY/MM/DD.md                          │  │
│   │  Trigger: After reflect, configurable threshold                      │  │
│   │  Constraint: Never deleted, only moved                               │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Observation scoring model:**

```
[type|c=confidence|i=importance]

Types: decision, preference, fact, commitment, milestone, lesson, relationship, project
Confidence: 0.0-1.0 (how certain the observer is)
Importance: 0.0-1.0 (how significant for future context)
```

**Promotion rules:**

- Observations with `i≥0.8` are candidates for immediate reflection
- Observations appearing `≥3` times across sessions are auto-promoted
- Reflections are permanent; observations can decay to archive

### 3. Strict Governance Model

The governance model prevents memory sprawl and ensures system stability.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Governance Constraints                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   PATH ALLOWLIST (Hard Enforcement)                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Writable by Observer:                                               │  │
│   │    - ledger/raw/**                                                   │  │
│   │    - observations/**                                                 │  │
│   │    - reflections/**                                                  │  │
│   │    - views/**                                                        │  │
│   │    - archive/**                                                      │  │
│   │                                                                      │  │
│   │  Read-only (indexed for context):                                    │  │
│   │    - decisions/**                                                    │  │
│   │    - lessons/**                                                      │  │
│   │    - projects/**                                                     │  │
│   │    - people/**                                                       │  │
│   │                                                                      │  │
│   │  Never auto-created:                                                 │  │
│   │    - Any path not in allowlist                                       │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   ATOMIC WRITES                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  1. Write to .tmp file                                               │  │
│   │  2. Validate schema                                                  │  │
│   │  3. Acquire lockfile                                                 │  │
│   │  4. Atomic rename to target                                          │  │
│   │  5. Release lockfile                                                 │  │
│   │  6. Update graph index                                               │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   LOCKFILE ENFORCEMENT                                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Location: .clawvault/observer.lock                                  │  │
│   │  Contents: { pid, timestamp, operation, target_path }                │  │
│   │  Timeout: 30 seconds (stale lock auto-release)                       │  │
│   │  Conflict resolution: Fail-fast, no retry                            │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   DETERMINISTIC PROMOTION                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Promotion criteria (all must be deterministic):                     │  │
│   │    - Repetition count ≥ threshold                                    │  │
│   │    - Importance score ≥ threshold                                    │  │
│   │    - Time since first observation ≥ threshold                        │  │
│   │                                                                      │  │
│   │  No probabilistic or LLM-based promotion decisions                   │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why strict governance matters:**

1. **Governance > Autonomy**: Agents are goal-driven; memory is governance infrastructure. These should not be the same component.
2. **No Self-Editing History**: If an agent can write memory, it can rewrite context, overemphasize its own interpretation, or suppress contradictory evidence.
3. **Consistency Across Agents**: Multiple agents → multiple writing styles → structural drift. A single observer enforces one schema.
4. **Replayability**: Memory must be rebuildable from raw transcripts. Arbitrary agent writes break determinism.
5. **Sprawl Prevention**: Agents will create pages/categories opportunistically. Observer → reflection → compiled views keeps surface area bounded.

### 4. Replay Engine

The replay engine enables historical export ingestion and validates ledger-first principles.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Replay Engine                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   SUPPORTED SOURCES                                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  - ChatGPT exports (conversations.json)                              │  │
│   │  - Claude exports (claude_conversations.json)                        │  │
│   │  - Claude Code session logs                                          │  │
│   │  - OpenCode transcripts                                              │  │
│   │  - OpenClaw session exports                                          │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   REPLAY PIPELINE                                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                                                                      │  │
│   │   Raw Export                                                         │  │
│   │       │                                                              │  │
│   │       ▼                                                              │  │
│   │   ┌──────────┐                                                       │  │
│   │   │ Normalize│  Convert to canonical ledger format                   │  │
│   │   └────┬─────┘                                                       │  │
│   │        │                                                             │  │
│   │        ▼                                                             │  │
│   │   ┌──────────┐                                                       │  │
│   │   │ Observe  │  Extract observations chronologically                 │  │
│   │   └────┬─────┘                                                       │  │
│   │        │                                                             │  │
│   │        ▼                                                             │  │
│   │   ┌──────────┐                                                       │  │
│   │   │ Reflect  │  Generate weekly reflections                          │  │
│   │   └────┬─────┘                                                       │  │
│   │        │                                                             │  │
│   │        ▼                                                             │  │
│   │   ┌──────────┐                                                       │  │
│   │   │ Compile  │  Build views from reflections                         │  │
│   │   └────┬─────┘                                                       │  │
│   │        │                                                             │  │
│   │        ▼                                                             │  │
│   │   ┌──────────┐                                                       │  │
│   │   │  Index   │  Update graph and search indices                      │  │
│   │   └──────────┘                                                       │  │
│   │                                                                      │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   DETERMINISM REQUIREMENT                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Replay output MUST match live output for identical inputs.          │  │
│   │                                                                      │  │
│   │  Validation: replay(export) == rebuild(ledger/raw/<source>/)         │  │
│   │                                                                      │  │
│   │  If outputs differ, the pipeline has non-deterministic behavior      │  │
│   │  that must be fixed before production use.                           │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**CLI interface:**

```bash
# Replay historical exports
clawvault replay --source chatgpt --input ~/exports/conversations.json
clawvault replay --source claude --input ~/exports/claude_conversations.json
clawvault replay --source openclaw --input ~/exports/sessions/

# Rebuild from raw ledger (validates determinism)
clawvault rebuild --from ledger/raw/ --validate

# Verify replay determinism
clawvault replay --source chatgpt --input export.json --dry-run --diff
```

### 5. Bounded Graph Expansion

The graph index is a derived artifact used for context enrichment, not a primary data store.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Bounded Graph Model                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   GRAPH DERIVATION                                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Sources (read-only):                                                │  │
│   │    - Tags (#tag extraction from observations/reflections)            │  │
│   │    - Wiki links ([[page]] extraction)                                │  │
│   │    - Reflection relations (co-occurrence in reflections)             │  │
│   │    - Frontmatter metadata (project, owner, related)                  │  │
│   │                                                                      │  │
│   │  Output: .clawvault/graph-index.json                                 │  │
│   │                                                                      │  │
│   │  Constraint: Graph NEVER auto-creates pages                          │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   BOUNDED EXPANSION                                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                                                                      │  │
│   │   Query: "database migration"                                        │  │
│   │                                                                      │  │
│   │   Hop 0 (seed):     [database-migration.md]                          │  │
│   │                           │                                          │  │
│   │   Hop 1 (neighbors): [postgresql.md] [schema-v2.md] [backups.md]     │  │
│   │                           │                                          │  │
│   │   Hop 2 (max):       [infrastructure.md] [q1-roadmap.md]             │  │
│   │                           │                                          │  │
│   │   STOP (--max-hops=2)    ✗                                           │  │
│   │                                                                      │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   CONFIGURATION                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  .clawvault/config.json:                                             │  │
│   │  {                                                                   │  │
│   │    "graph": {                                                        │  │
│   │      "maxHops": 2,                                                   │  │
│   │      "maxNeighbors": 10,                                             │  │
│   │      "excludePaths": ["archive/**"],                                 │  │
│   │      "derivedOnly": true                                             │  │
│   │    }                                                                 │  │
│   │  }                                                                   │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   INDEX WHITELIST                                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  Indexed paths (for qmd/search):                                     │  │
│   │    - views/**                                                        │  │
│   │    - reflections/**                                                  │  │
│   │    - observations/** (active only, not archived)                     │  │
│   │    - decisions/**                                                    │  │
│   │    - lessons/**                                                      │  │
│   │                                                                      │  │
│   │  NOT indexed:                                                        │  │
│   │    - archive/** (cold storage)                                       │  │
│   │    - ledger/raw/** (source data, not searchable)                     │  │
│   │                                                                      │  │
│   │  Principle: Finite index, infinite history                           │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Integration

### ClawVault v3 Split Architecture

ClawVault v3 separates concerns into two components:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ClawVault v3 Architecture                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                     ClawVault CLI                                    │  │
│   │                                                                      │  │
│   │  Workspace primitives only:                                          │  │
│   │    - tasks, projects, scaffold                                       │  │
│   │    - checkpoint, recover                                             │  │
│   │    - kanban, canvas                                                  │  │
│   │                                                                      │  │
│   │  Agents write WORK, not memory                                       │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │              ClawVault Plugin (@versatly/clawvault-plugin)           │  │
│   │                                                                      │  │
│   │  Memory ownership:                                                   │  │
│   │    - Observation engine (session compression)                        │  │
│   │    - Context injection (budget-aware, priority-sorted)               │  │
│   │    - Memory search (qmd + semantic)                                  │  │
│   │    - Reflection promotion (weekly patterns)                          │  │
│   │    - Replay engine (historical imports)                              │  │
│   │                                                                      │  │
│   │  The agent NEVER writes memory — the system observes and remembers   │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Observer Mode Toggle

For users who want strict ledger-first behavior:

```bash
# Enable observer-only mode (Option A from issue discussion)
clawvault config set observer.mode strict

# In strict mode:
# - Agents cannot call `store`, `capture`, or edit vault files directly
# - The ONLY way memories enter the vault is through the observer pipeline
# - All memory flows bottom-up from conversations
```

### Integration Points

| Hook | Stage | Description |
|------|-------|-------------|
| `observe` | Ledger entrypoint | Compress session → write to ledger/raw/ |
| `sleep` | Compiler trigger | Delegate to observe → reflect → compile |
| `wake` | Context injection | Load views + recent observations |
| `cron.weekly` | Reflection | Run full reflect → compile → archive |

---

## File Format Specifications

### Ledger Entry (JSONL)

```jsonl
{"ts":"2026-02-23T10:15:00Z","role":"user","content":"Let's use PostgreSQL for the new service"}
{"ts":"2026-02-23T10:15:30Z","role":"assistant","content":"Good choice. PostgreSQL offers..."}
{"ts":"2026-02-23T10:16:00Z","role":"user","content":"Document this as a decision"}
```

### Observation (Markdown)

```markdown
---
date: 2026-02-23
source: openclaw
session: abc123
---

## Observations

- [decision|c=0.9|i=0.8] Use PostgreSQL for new service - chosen for JSONB support and reliability
- [preference|c=0.7|i=0.5] User prefers explicit documentation of architectural decisions
- [fact|c=0.95|i=0.3] Current stack includes Node.js and TypeScript
```

### Reflection (Markdown)

```markdown
---
week: 2026-W08
observations_processed: 42
promoted_count: 7
---

## Stable Patterns

### Decisions
- [decision|c=0.9|i=0.85|count=3] PostgreSQL is the default database choice
  - First observed: 2026-02-20
  - Sources: sessions abc123, def456, ghi789

### Preferences  
- [preference|c=0.8|i=0.7|count=5] Document all architectural decisions explicitly
  - First observed: 2026-02-18
  - Consistent across all planning sessions
```

### View (Markdown)

```markdown
---
compiled: 2026-02-23T12:00:00Z
source: reflections/2026-W08.md
---

# Current Context

## Key Decisions
- PostgreSQL is the default database (JSONB, reliability)

## Active Preferences
- Document architectural decisions explicitly

## Recent Focus
- Database migration planning
- Q1 roadmap finalization
```

---

## Implementation Checklist

- [x] Scored importance model (`[type|c=confidence|i=importance]`)
- [x] Ledger-first architecture (raw transcripts in `ledger/raw/`)
- [x] `clawvault reflect` command
- [x] `clawvault replay` command (ChatGPT, Claude, OpenCode, OpenClaw)
- [x] `clawvault rebuild` command
- [x] `clawvault archive` command
- [x] Graph guardrails (`--max-hops`, derived-only, archive exclusion)
- [x] Observer mode toggle (strict vs permissive)
- [ ] Lockfile enforcement for multi-agent scenarios
- [ ] Determinism validation in CI

---

## References

- [Original OM Proposal (Gist)](https://gist.github.com/imrane/0009ab4bbcfc8a881bfc5bc6a8cd17d5)
- [Issue #4 Discussion](https://github.com/Versatly/clawvault/issues/4)
- [ClawVault Plugin Repository](https://github.com/Versatly/clawvault-plugin)
- [v2.2.0 Release Notes](https://github.com/Versatly/clawvault/releases/tag/v2.2.0)
