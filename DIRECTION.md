# ClawVault v3 Direction

## What ClawVault Is

A structured memory system for AI agents. Markdown-based vault with typed primitives,
knowledge graph, hybrid search, and observational capture.

## Architecture: 4 Packages, 1 Monorepo

### 1. `clawvault` (root package) — The Engine
The CLI and core library. Vault CRUD, search, templates, links, graph, observer.
Developers use this. Published to npm as `clawvault`.

### 2. `@clawvault/openclaw-plugin` (packages/plugin) — The Agent Layer
OpenClaw memory slot provider. Auto-capture (observational), auto-recall, hybrid search.
Tools: memory_search, memory_get, memory_store, memory_forget.
**This is the primary user-facing package.** When someone "uses ClawVault," they install this.

### 3. `@clawvault/obsidian` (packages/obsidian) — The Human Layer
Obsidian plugin for browsing, editing, and visualizing agent memory.
Graph view, workstream view, ops dashboard.
Makes the vault visible and editable by humans.

### 4. `@clawvault/sdk` (packages/sdk) — The API Layer
TypeScript SDK for programmatic vault access. For custom integrations.

## Core Concepts

### Vault Primitives
Typed markdown documents: task, project, decision, lesson, person, memory_event, etc.
Each has a template (schema), storage directory, and writer policy.

### Writer Policy
Controls which actors (cli, human, agent, observer) can write to which primitives.
Critical for observational memory integrity — agents shouldn't forge human decisions.

### Event Ledger
Append-only log of all vault changes. Every create, update, transition, link is recorded.
Enables audit trail, replay, and sync.

### Observational Memory
The agent doesn't explicitly "store memories." The plugin observes conversations and
automatically extracts preferences, decisions, facts, contacts, deadlines.
memory_store exists as fallback but is NOT the primary path.

## What We Don't Do
- **Orchestration** — OpenClaw does that
- **LLM inference** — Use the host agent's model
- **Database** — Markdown files, not SQL/vector DB (qmd handles embeddings)
- **Breaking migrations** — We have <10 users. Ship forward, don't migrate backward.

## Repo Structure
```
clawvault/
├── bin/                  # CLI entry points
├── src/                  # Engine source
├── packages/
│   ├── plugin/           # @clawvault/openclaw-plugin
│   ├── sdk/              # @clawvault/sdk
│   └── obsidian/         # @clawvault/obsidian (coming)
├── hooks/                # Legacy hook pack (disabled)
├── schemas/              # JSON schemas
├── templates/            # Vault primitive templates
├── scripts/              # Build/release
├── docs/                 # Product docs
├── tests/                # Test suite
└── .github/              # CI
```
