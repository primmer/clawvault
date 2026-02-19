# CLI Reference

Complete reference for all ClawVault CLI commands.

## Installation

```bash
npm install -g clawvault
```

Verify: `clawvault --version`

## Vault Management

### `clawvault init [path]`

Initialize a new vault.

```bash
clawvault init ~/my-vault --name my-brain
```

Options:
- `--name <name>` — vault name

### `clawvault setup`

Auto-discover and configure an existing vault. Creates Obsidian Bases views for tasks, projects, and backlog.

```bash
cd ~/my-vault
clawvault setup
```

### `clawvault doctor`

Diagnose vault health and optionally apply fixes.

```bash
clawvault doctor          # check only
clawvault doctor --fix    # check and fix
```

### `clawvault status`

Show vault health, statistics, and document counts.

### `clawvault stats`

Detailed vault statistics.

### `clawvault compat`

Check OpenClaw compatibility — verifies plugin manifest, extensions entry, and required files.

## Memory Operations

### `clawvault store`

Store a new typed memory document interactively.

### `clawvault capture <note>`

Quick-capture a note to the inbox.

```bash
clawvault capture "Pedro prefers dark mode for all UIs"
```

### `clawvault remember <type> <title>`

Store a typed memory directly.

```bash
clawvault remember decision "Use PostgreSQL for user data"
clawvault remember lesson "Always test in isolation before deploying"
```

Types: `fact`, `feeling`, `decision`, `lesson`, `commitment`, `preference`, `relationship`, `project`

### `clawvault list [category]`

List vault documents, optionally filtered by category.

```bash
clawvault list            # all documents
clawvault list task       # only tasks
clawvault list decision   # only decisions
```

### `clawvault get <id>`

Get a specific document by ID.

## Search

### `clawvault search <query>`

BM25 keyword search via qmd.

```bash
clawvault search "deployment architecture"
```

### `clawvault vsearch <query>`

Semantic vector search via qmd.

```bash
clawvault vsearch "how should we handle authentication?"
```

### `clawvault embed`

Run qmd embedding for pending vault documents. Required before `vsearch` works.

## Context & Injection

### `clawvault context <task>`

Generate task-relevant context from the vault. Useful for prompt injection before complex work.

```bash
clawvault context "refactor the auth module"
```

### `clawvault inject <message>`

Inject relevant rules, decisions, and preferences for a given message.

```bash
clawvault inject "should we migrate to Vercel?"
```

## Session Lifecycle

### `clawvault wake`

Start a session: recovers from context death, generates a recap of recent state.

### `clawvault sleep <summary>`

End a session with a handoff document.

```bash
clawvault sleep "completed auth refactor, all tests passing"
```

### `clawvault checkpoint`

Save a quick state checkpoint for context-death resilience.

### `clawvault recover`

Check for context death and recover state.

## Tasks

### `clawvault task`

Task management subcommands:

```bash
clawvault task list              # list all tasks
clawvault task create            # create a new task
clawvault task update <id>       # update a task
clawvault task transition <id>   # transition task status
```

### `clawvault project`

Project management — group related tasks.

### `clawvault kanban`

Display tasks in a Kanban board view.

### `clawvault backlog`

Show backlog items.

### `clawvault blocked`

Show blocked items needing attention.

### `clawvault archive`

Archive old observations.

## Observation Pipeline

### `clawvault observe`

Process session transcripts into observational memory. Reads session files, extracts durable information, and writes typed documents.

### `clawvault reflect`

Promote stable observations into weekly reflections — consolidates patterns.

### `clawvault reweave`

Backward memory consolidation. Detects and marks observations that have been superseded by newer information.

### `clawvault rebuild`

Rebuild observations from raw transcripts.

### `clawvault replay`

Replay historical conversation exports through the observe pipeline.

### `clawvault session-recap <sessionKey>`

Generate a recap from a specific OpenClaw session transcript.

### `clawvault migrate-observations`

Convert legacy observation format to current format.

## Graph & Entities

### `clawvault graph`

Show the typed memory graph — relationships between documents via wiki-links.

### `clawvault entities`

List all linkable entities in the vault.

### `clawvault link [file]`

Auto-link entity mentions in markdown files with wiki-links.

## Templates

### `clawvault template`

Template management:

```bash
clawvault template list          # list available templates
clawvault template show <name>   # show template schema
```

## Utilities

### `clawvault reindex`

Rebuild the search index.

### `clawvault repair-session`

Repair corrupted OpenClaw session transcripts.

### `clawvault shell-init`

Output shell integration for ClawVault (source in your .zshrc/.bashrc).

### `clawvault plugin-path`

Print the OpenClaw plugin entry point path — useful for manual configuration.
