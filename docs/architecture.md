# Architecture

## Overview

ClawVault has three layers: the vault (files), the plugin (agent integration), and the CLI (developer interface).

```
     HUMAN (Obsidian)
     Browse, edit, approve
           │
           ▼
  ┌─── VAULT (markdown) ───┐
  │  Typed primitives       │
  │  Knowledge graph        │
  │  Template schemas       │
  └───┬──────────────┬──────┘
      │              │
 AGENT (Plugin)   CLI (Developer)
 Auto-capture     Direct CRUD
 Auto-recall      Search, graph
 Session recap    Tasks, projects
```

## The Vault

A vault is a directory of markdown files. Each file is a typed primitive — a task, decision, lesson, person, or any custom type defined by a template.

### File Structure

```
my-vault/
  .clawvault.json       # Vault config
  .clawvault/           # Runtime state (checkpoints, flags)
  templates/            # Schema definitions
  tasks/                # Task documents
  decisions/            # Decision records
  lessons/              # Learned lessons
  people/               # Contacts and people
  projects/             # Project containers
  inbox/                # Quick captures
  handoffs/             # Session handoffs
```

### Document Format

Every document is markdown with YAML frontmatter:

```markdown
---
type: decision
status: decided
created: 2026-02-19
project: auth-refactor
---

# Use JWT for API authentication

We chose JWT over session cookies because:
- Stateless — no server-side session store needed
- Works across microservices
- Standard tooling in every language

Trade-off: tokens can't be revoked without a blocklist.
```

### Wiki-Links

Documents reference each other with `[[wiki-links]]`, building a knowledge graph:

```markdown
Discussed with [[Pedro Sobral]] during the [[auth-refactor]] project.
See also [[lesson: always validate token expiry]].
```

## The Plugin

The OpenClaw plugin bridges the vault with the running agent.

### Registration

```javascript
// dist/plugin/index.js
export default {
  id: "clawvault",
  version: "3.1.0",
  kind: "memory",
  register(api) {
    // Register tools
    api.registerTool("memory_search", ...);
    api.registerTool("memory_store", ...);
    api.registerTool("memory_get", ...);
    api.registerTool("memory_forget", ...);

    // Register lifecycle hooks
    api.on("before_agent_start", autoRecall);
    api.on("message_received", autoCapture);
    api.on("agent_end", autoCapture);
    api.on("before_compaction", preserveContext);
  }
};
```

### Search Pipeline

```
Query → qmd hybrid search → BM25 candidates + vector candidates → rerank → top-K results
```

All local. qmd handles tokenization, BM25 scoring, embedding, and reranking in a single binary.

### Auto-Capture Pipeline

```
Message → classify against template schemas → extract structured fields → write typed document
```

The plugin reads `templates/` on boot. Adding a new template means the plugin can create that type — no code changes.

## The CLI

The CLI provides direct CRUD operations, search, and lifecycle commands for developers and agents.

### Build

Built with [tsup](https://tsup.egoist.dev/). Outputs ESM + CJS + type declarations:

```
dist/
  index.js          # ESM library entry
  index.cjs         # CJS library entry
  index.d.ts        # Type declarations
  plugin/
    index.js        # Plugin entry (ESM)
    index.cjs       # Plugin entry (CJS)
  commands/         # Individual command modules
  lib/              # Shared library modules
```

### Entry Points

- **CLI**: `bin/clawvault.js` → loads commands from `dist/commands/`
- **Library**: `import { ... } from 'clawvault'` → `dist/index.js`
- **Plugin**: `import plugin from 'clawvault/plugin'` → `dist/plugin/index.js`

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `chalk` | Terminal colors |
| `gray-matter` | YAML frontmatter parsing |
| `glob` | File pattern matching |
| `natural` | NLP utilities (tokenization, stemming) |
| `chokidar` | File watching (observer) |
| `@sinclair/typebox` | Runtime type validation |

### External

| Tool | Purpose |
|------|---------|
| `qmd` | Hybrid search engine (BM25 + vector + reranking) |

## Observation Pipeline

The observer watches session transcripts and extracts durable memory:

```
Session transcript → observe → scored observations → reflect → weekly reflections → reweave → consolidation
```

This runs via CLI commands (`observe`, `reflect`, `reweave`) or automatically via the plugin's auto-capture hooks.

## Multi-Agent

Two agents sharing a vault share a world model. No message passing — the filesystem is the message bus.

```
Agent A writes task → Agent B reads task → Agent B updates status → Agent A sees update
```

Conflicts are handled at the file level. Last-write-wins for individual files. The transition ledger in task frontmatter preserves the full history.
