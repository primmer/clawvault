---
name: clawvault
version: "3.1.0"
description: "Structured memory for AI agents. Typed markdown primitives that compound over time. Install to give any agent persistent, searchable, human-readable memory."
user-invocable: true
openclaw:
  emoji: "🧠"
  requires:
    bins: ["clawvault", "qmd"]
    env: []
  install:
    - id: plugin
      kind: openclaw-plugin
      package: clawvault
      label: "Install ClawVault plugin"
    - id: qmd
      kind: node
      package: "github:tobi/qmd"
      bins: ["qmd"]
      label: "Install qmd search engine"
---

# ClawVault — Structured Memory for Agents

## What It Is

ClawVault gives agents persistent, typed, searchable memory using plain markdown files.

Every memory is a **typed primitive** — a markdown file with YAML frontmatter following a schema. The agent reads and writes these files. Humans browse them in Obsidian or any editor.

## Install

### As OpenClaw Plugin (recommended)

```bash
openclaw plugins install clawvault
openclaw config set plugins.clawvault.config.vaultPath ~/my-vault
openclaw gateway restart
```

### As Standalone CLI

```bash
npm install -g clawvault
```

## Primitives

ClawVault ships with these default primitive types (defined in `templates/`):

| Type | Directory | Purpose |
|------|-----------|---------|
| `task` | `tasks/` | Things to do — status, priority, owner, due date |
| `project` | `projects/` | Groups of related tasks |
| `decision` | `decisions/` | Choices made and why |
| `lesson` | `lessons/` | Mistakes made, patterns learned |
| `person` | `people/` | Contacts, relationships, preferences |
| `memory-event` | `memories/` | General observations, preferences, facts |

Templates are **malleable** — users can edit `templates/*.md` to add fields, remove fields, or create entirely new primitive types. The agent reads the schema and adapts.

## OpenClaw Plugin

When installed as a plugin, ClawVault:

1. **Auto-recalls** relevant memories before each agent turn (hybrid BM25 + vector search)
2. **Auto-captures** observations from conversations (preferences, decisions, contacts)
3. **Injects session recap** on first turn (active tasks, recent decisions, current focus)
4. **Provides tools**: `memory_search`, `memory_get`, `memory_store`, `memory_forget`

### Plugin Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `vaultPath` | — | Path to vault directory (required) |
| `collection` | `clawvault` | qmd search collection name |
| `autoRecall` | `true` | Inject memories before each turn |
| `autoCapture` | `true` | Auto-store from conversations |
| `recallLimit` | `5` | Max memories per recall (1-20) |

## Setting Up Your Vault

### New Agent

```bash
clawvault init ~/my-vault --name my-brain
clawvault setup   # creates Obsidian Bases views
```

### Existing Agent (Has Memory/Workspace Files)

If you already have OpenClaw workspace files (MEMORY.md, SOUL.md, USER.md, daily logs), the agent should set up its own vault by reading existing memory and creating typed primitives.

**Agent directive for vault setup:**

> Read your workspace files (MEMORY.md, USER.md, memory/*.md). For each piece of durable knowledge:
> - People mentioned with contact info → create `people/name.md` with person template
> - Decisions made → create `decisions/slug.md` with decision template
> - Lessons learned → create `lessons/slug.md` with lesson template
> - Active tasks/todos → create `tasks/slug.md` with task template
> - Preferences/facts → create `memories/slug.md` with memory-event template
>
> Read `templates/*.md` in your vault to understand the schema for each type.
> Deduplicate: search existing vault files before creating new ones.

## CLI Commands

### Vault Management
```bash
clawvault init [path]             # Create new vault
clawvault setup                   # Configure Obsidian views
clawvault status                  # Vault health
clawvault doctor                  # Diagnostics
clawvault compat                  # Check OpenClaw compatibility
```

### Memory Operations
```bash
clawvault store                   # Store typed memory (interactive)
clawvault capture <note>          # Quick-capture to inbox
clawvault remember <type> <title> # Store typed memory directly
clawvault list [category]         # List vault documents
clawvault get <id>                # Get document by ID
```

### Search
```bash
clawvault search <query>          # BM25 keyword search
clawvault vsearch <query>         # Semantic vector search
clawvault context <task>          # Task-relevant context
clawvault inject <message>        # Inject rules/decisions/preferences
```

### Observation Pipeline
```bash
clawvault observe                 # Extract observations from sessions
clawvault reflect                 # Promote to weekly reflections
clawvault reweave                 # Backward consolidation
clawvault replay <file>           # Import conversation exports
```

### Tasks & Projects
```bash
clawvault task add <title>        # Create task
clawvault task list               # List tasks
clawvault task done <slug>        # Complete task
clawvault project list            # List projects
clawvault kanban                  # Kanban board view
clawvault blocked                 # Show blocked items
```

### Session Lifecycle
```bash
clawvault wake                    # Start session (recover + recap)
clawvault sleep <summary>         # End session with handoff
clawvault checkpoint              # Save state checkpoint
clawvault recover                 # Recover from context death
```

### Knowledge Graph
```bash
clawvault graph                   # Graph summary
clawvault entities                # List linkable entities
clawvault link [file]             # Auto-link entity mentions
```

## Template Schema Format

```yaml
---
primitive: task
fields:
  status:
    type: string
    required: true
    default: open
    enum: [open, in-progress, blocked, done]
  priority:
    type: string
    enum: [critical, high, medium, low]
  owner:
    type: string
  due:
    type: date
---
```

To create a custom primitive: add a new `.md` file to `templates/` with the schema. The plugin discovers it automatically on next boot.

## Vault Structure

```
vault/
├── tasks/           # Active work items
├── projects/        # Project definitions
├── decisions/       # Decision records
├── lessons/         # Accumulated wisdom
├── people/          # Contacts and relationships
├── memories/        # General observations
├── templates/       # Primitive schemas (customizable)
├── .clawvault.json  # Vault config
└── .obsidian/       # Obsidian settings (optional)
```

## Troubleshooting

```bash
clawvault doctor          # Full diagnostics
clawvault compat          # Check OpenClaw compatibility
qmd status -c clawvault   # Search index status
qmd update -c clawvault   # Reindex vault files
qmd embed -c clawvault    # Update embeddings
```
