# ClawVault — Direction

## The Problem

AI agents forget everything between sessions. They lose context, repeat mistakes, forget preferences, can't learn from experience. Every conversation starts from zero.

Current solutions are either:
- **Vector databases** (Mem0, LangMem) — unstructured blob storage, no schema, no audit trail, no human visibility
- **RAG-only** (lancedb, chromadb) — retrieval without structure, can't distinguish a decision from a preference from a fact
- **Prompt stuffing** — shove everything into context, hope the model figures it out

None of them give you **structured, typed, auditable memory that both agents and humans can read and write**.

## What ClawVault Is

A structured memory system built on plain markdown files.

Every memory is a **typed primitive** — a markdown document with frontmatter that follows a schema. A `decision` has a status, date, and rationale. A `task` has an owner, priority, and blocklist. A `person` has a relationship type and contact info. This isn't a database — it's a knowledge graph you can open in any text editor.

The vault is the **shared substrate** between agent and human:
- The agent writes observations automatically (it doesn't know it's doing it)
- The human browses and edits in Obsidian (or any markdown editor)
- Wiki-links create a traversable knowledge graph
- Everything is audited in an append-only event ledger

## The Ecosystem (4 packages)

### `clawvault` — The Engine

The CLI and core library. This is the foundation everything else builds on.

**What it does:**
- `clawvault init` — create a new vault with typed primitive directories
- `clawvault store/capture/remember` — write memories
- `clawvault search/vsearch` — BM25 and semantic search (via qmd)
- `clawvault observe` — watch session transcripts, extract observations automatically
- `clawvault reflect` — promote stable observations into consolidated reflections
- `clawvault graph/entities/link` — knowledge graph operations
- `clawvault task/project/backlog` — work tracking primitives
- `clawvault context/inject` — generate task-relevant context for prompt injection
- `clawvault wake/sleep/checkpoint/recover` — session lifecycle and context death resilience
- `clawvault doctor/status/compat` — health diagnostics
- `clawvault template` — manage primitive schemas
- `clawvault replay` — import conversations from ChatGPT, Claude, OpenClaw, OpenCode

**What it becomes in v3:**
Every write goes through the primitive registry and writer policy. Every mutation is logged to the event ledger. The CLI becomes a typed, auditable, policy-enforced vault engine — not just a collection of markdown helpers.

**Published as:** `clawvault` on npm (already live, v2.7.0)

### `@versatly/clawvault-plugin` — The Agent Layer

The OpenClaw memory slot plugin. This is how agents USE ClawVault without thinking about it.

**What it does:**
- **Auto-capture** (observational) — hooks into `message_received` and `agent_end` events. Extracts preferences, decisions, facts, contacts, deadlines from conversation. The agent never calls `memory_store` — it just happens.
- **Auto-recall** — before every agent turn, searches the vault for relevant context. Strips conversational noise, extracts real search terms, returns ranked results.
- **Hybrid search** — BM25 keyword + vector similarity + reranking. Not just "nearest embedding."
- **Tools** — `memory_search`, `memory_get`, `memory_store` (fallback), `memory_forget`
- **Pre-compaction hook** — extracts important context before OpenClaw compacts conversation history

**What it becomes in v3:**
- Observations go through the primitive registry (typed as `memory_event` primitives)
- Every capture is logged to the event ledger
- Writer policy ensures the observer can only write `memory_event` types, not forge `decision` or `task` primitives
- Quality gates (from arscontexta research): verify observations are retrievable and non-redundant before committing

**Published as:** `@versatly/clawvault-plugin` on npm (not yet published)

### `@versatly/clawvault-obsidian` — The Human Layer

Obsidian plugin that makes agent memory visible and editable by humans.

**What it does:**
- **Graph view** — visualize the vault's knowledge graph (nodes = primitives, edges = wiki-links)
- **Workstream view** — see active tasks, projects, blockers across the vault
- **Ops dashboard** — vault health, observation counts, ledger activity
- **Read from control plane snapshots** — `clawvault` generates snapshots, Obsidian renders them

**What it becomes:**
- Real-time sync (watch vault changes, live-update views)
- Edit primitives with schema-aware forms (not raw frontmatter)
- Approve/reject agent observations (human-in-the-loop memory curation)
- Timeline view of the event ledger

**Published as:** `@versatly/clawvault-obsidian` (Obsidian community plugin + npm)

### `@versatly/clawvault-sdk` — The API Layer

TypeScript SDK for programmatic vault access. For building custom integrations.

**What it does:**
- `vault.search(query)` / `vault.vsearch(query)` — search
- `vault.observe(sessionPath)` — run observation pipeline
- `vault.store(type, title, content)` — write a typed primitive
- `vault.context(task)` — generate context injection
- `vault.status()` / `vault.doctor()` — health checks

**Published as:** `@versatly/clawvault-sdk` on npm (not yet published)

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  HUMAN (Obsidian)                │
│           Browse, edit, approve memories         │
│            @versatly/clawvault-obsidian          │
└────────────────────┬────────────────────────────┘
                     │ reads/writes markdown
┌────────────────────▼────────────────────────────┐
│               VAULT (markdown files)             │
│                                                  │
│  Typed primitives:  task, project, decision,     │
│  lesson, person, memory_event, workspace, run    │
│                                                  │
│  Knowledge graph:  wiki-links between docs       │
│  Event ledger:     append-only audit log         │
│  Primitive registry: type definitions + policies │
└────────┬───────────────────────────┬────────────┘
         │                           │
┌────────▼──────────┐    ┌──────────▼────────────┐
│  AGENT (Plugin)   │    │   DEVELOPER (CLI)      │
│  Observational    │    │   Vault CRUD           │
│  capture + recall │    │   Search, graph, tasks │
│  @versatly/       │    │   clawvault (npm)      │
│  clawvault-plugin │    │                        │
└───────────────────┘    └───────────────────────┘
```

## What Makes This Different

1. **Structured, not blob storage.** Every memory has a type, schema, and policy. A decision is a decision, not a vector in a table.

2. **Observational, not explicit.** The agent doesn't manage its own memory. It just talks. The plugin watches and extracts. This is how human memory works — you don't decide to remember, you just do.

3. **Human-readable and human-editable.** It's markdown files. Open them in Obsidian, VS Code, vim, whatever. No proprietary format, no database to query, no export needed.

4. **Auditable.** Every write is logged to the event ledger with actor, timestamp, and idempotency key. You can see exactly what the agent wrote, when, and why.

5. **Policy-enforced.** Writer policies control who can write what. The observer can create `memory_event` primitives but can't forge a `decision`. The human can override anything. The agent can read everything but only write through sanctioned paths.

6. **Works with any agent platform.** The CLI is platform-agnostic. The plugin targets OpenClaw today, but the SDK works with anything. Runtime adapters normalize events from OpenClaw, Claude Code, or any future platform.

## Repo Structure

```
Versatly/clawvault
├── src/                  # Engine source (TypeScript)
│   ├── commands/         # CLI command implementations
│   ├── lib/              # Core libraries
│   ├── workgraph/        # Primitive registry, writer policy, event ledger
│   ├── runtime/          # Platform adapters (OpenClaw, Claude Code)
│   └── observer/         # Observation pipeline
├── bin/                  # CLI entry point + command registration
├── packages/
│   ├── plugin/           # @versatly/clawvault-plugin
│   ├── sdk/              # @versatly/clawvault-sdk
│   └── obsidian/         # @versatly/clawvault-obsidian
├── templates/            # Primitive schemas (14 types)
├── shared/               # Constants (registry limits, identifier rules)
├── hooks/                # Legacy OpenClaw hook pack
├── schemas/              # JSON schemas
├── scripts/              # Build scripts
├── docs/                 # Product docs
├── tests/                # Test suite
└── .github/              # CI
```

## npm Publishing

All packages under the `@versatly` org scope:
- `clawvault` — root package (already on npm)
- `@versatly/clawvault-plugin`
- `@versatly/clawvault-sdk`
- `@versatly/clawvault-obsidian`

## Priority

1. **Plugin** — the thing people install and use today
2. **CLI stability** — wire workgraph types into existing commands
3. **Obsidian plugin** — make agent memory visible to humans
4. **SDK** — programmatic access for integrations
