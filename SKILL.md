---
name: clawvault
version: "3.0.0"
description: "Structured memory for AI agents. Typed markdown primitives that compound over time. Install to give any agent persistent, searchable, human-readable memory."
user-invocable: true
openclaw:
  emoji: "🧠"
  requires:
    bins: ["clawvault", "qmd"]
    env: []
  install:
    - id: node
      kind: node
      package: clawvault
      bins: ["clawvault"]
      label: "Install ClawVault (npm)"
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

```bash
npm i -g clawvault
clawvault init
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

## For OpenClaw Agents

ClawVault includes an OpenClaw memory plugin. When loaded, it:

1. **Auto-recalls** relevant memories before each agent turn
2. **Auto-captures** observations from conversations (preferences, decisions, contacts)
3. **Injects session recap** on first turn (active tasks, recent decisions, current focus)
4. **Provides tools**: `memory_search`, `memory_get`, `memory_store`, `memory_forget`

Configuration in OpenClaw:
```json
{
  "plugins": {
    "load": { "paths": ["clawvault/plugin"] },
    "slots": { "memory": "clawvault" },
    "entries": {
      "clawvault": {
        "enabled": true,
        "config": { "vaultPath": "~/.openclaw/vault" }
      }
    }
  }
}
```

## Setting Up Your Vault

### New Agent (No Existing Memory)

```bash
clawvault init --vault ~/.openclaw/vault
```

This creates the vault structure with default templates and directories.

### Existing Agent (Has Memory/Workspace Files)

If you already have OpenClaw workspace files (MEMORY.md, SOUL.md, USER.md, daily logs), the agent should set up its own vault by reading its existing memory and creating typed primitives.

**Agent directive for vault setup:**

> Read your workspace files (MEMORY.md, USER.md, memory/*.md). For each piece of durable knowledge:
> - People mentioned with contact info → create `people/name.md` with person template
> - Decisions made → create `decisions/slug.md` with decision template
> - Lessons learned → create `lessons/slug.md` with lesson template
> - Active tasks/todos → create `tasks/slug.md` with task template
> - Preferences/facts → create `memories/slug.md` with memory-event template
>
> Read `templates/*.md` in your vault to understand the schema for each type.
> Use YAML frontmatter matching the template fields. Write the details in the body.
> Deduplicate: search existing vault files before creating new ones.

The agent is better at classifying and extracting structured knowledge from unstructured text than any regex parser. Let it do the work.

## CLI Commands

```bash
# Vault management
clawvault init                    # Create new vault
clawvault setup                   # Configure Obsidian views, graph colors
clawvault status                  # Vault health
clawvault doctor                  # Diagnostics

# Memory operations
clawvault search "query"          # BM25 keyword search
clawvault vsearch "query"         # Vector/semantic search
clawvault observe <session>       # Extract observations from a session transcript
clawvault reflect                 # Promote stable observations to reflections

# Primitives
clawvault task add "title"        # Create task
clawvault task done <slug>        # Complete task
clawvault task list               # List tasks
clawvault project list            # List projects

# Knowledge graph
clawvault graph                   # Show graph stats
clawvault entities                # List entity index
clawvault link                    # Auto-link vault files

# Session lifecycle
clawvault wake                    # Generate session startup context
clawvault sleep                   # End-of-session summary
clawvault checkpoint              # Save current state
clawvault recover                 # Recover from context death

# Import
clawvault replay <file>           # Import from ChatGPT/Claude/OpenClaw exports
```

## Template Schema Format

Templates in `templates/*.md` define primitive schemas:

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
  tags:
    type: string[]
---

# {{title}}

{{content}}
```

To create a custom primitive: add a new `.md` file to `templates/` with the schema. The plugin discovers it automatically.

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
