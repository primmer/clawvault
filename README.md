# ClawVault

Structured memory for AI agents. Typed markdown primitives that compound over time.

[![npm](https://img.shields.io/npm/v/clawvault)](https://www.npmjs.com/package/clawvault)

Every memory is a markdown file with YAML frontmatter — a task, a decision, a person, a lesson — each following a schema defined in `templates/`. The agent reads and writes these files. The human browses them in Obsidian. No database. No vendor lock-in. Just files.

## Requirements

- Node.js 18+
- [`qmd`](https://github.com/qmd-project/qmd) installed and on `PATH` (hybrid BM25 + vector search)

## Install

### As an OpenClaw Plugin (recommended)

```bash
openclaw plugins install clawvault
```

This installs ClawVault as a memory plugin. It replaces OpenClaw's built-in memory with:

- **Auto-recall** — injects relevant memories before each agent turn
- **Auto-capture** — observes conversations and stores durable knowledge automatically
- **Session recap** — on wake, provides context from active tasks, recent decisions, and preferences
- **4 tools** — `memory_search`, `memory_store`, `memory_get`, `memory_forget`

After install, configure the vault path:

```bash
openclaw config set plugins.clawvault.config.vaultPath ~/my-vault
```

### As a Standalone CLI

```bash
npm install -g clawvault
```

## Quick Start

```bash
# Initialize a new vault
clawvault init ~/my-vault --name my-brain

# Set up Obsidian Bases views (tasks, projects, backlog)
clawvault setup

# Check vault health
clawvault doctor

# Search your vault
clawvault search "deployment decision"
```

## How It Works

### Typed Primitives

Every piece of memory has a type defined by a template:

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

Default templates: `task`, `decision`, `lesson`, `person`, `project`, `checkpoint`, `handoff`, `daily`, `trigger`, `run`, `party`, `workspace`.

### Malleable Schemas

Don't like the defaults? Drop your own template in your vault's `templates/` directory. Add fields, remove fields, create entirely new types. The plugin reads YOUR schemas, not ours.

### Hybrid Search

ClawVault uses `qmd` for search — BM25 keyword matching combined with vector similarity and reranking. Entirely local. No API keys needed.

### Obsidian Integration

Your vault IS an Obsidian vault. Tasks become Kanban boards. Decisions are searchable. Wiki-links build a knowledge graph. Five generated Bases views out of the box:

- All tasks
- Blocked items  
- By project
- By owner
- Backlog

## CLI Commands

### Core

| Command | Description |
|---------|-------------|
| `init [path]` | Initialize a new vault |
| `setup` | Auto-discover and configure a vault, create Obsidian views |
| `store` | Store a new typed memory document |
| `capture <note>` | Quick-capture a note to inbox |
| `doctor` | Diagnose vault health |

### Search & Context

| Command | Description |
|---------|-------------|
| `search <query>` | BM25 keyword search via qmd |
| `vsearch <query>` | Semantic vector search via qmd |
| `context <task>` | Generate task-relevant context |
| `inject <message>` | Inject relevant rules and decisions |

### Session Lifecycle

| Command | Description |
|---------|-------------|
| `wake` | Start a session (recover + recap) |
| `sleep <summary>` | End a session with a handoff |
| `checkpoint` | Save state for context-death resilience |
| `recover` | Check for and recover from context death |

### Observation Pipeline

| Command | Description |
|---------|-------------|
| `observe` | Process sessions into observational memory |
| `reflect` | Promote observations to weekly reflections |
| `reweave` | Backward consolidation — mark superseded observations |

### Tasks & Projects

| Command | Description |
|---------|-------------|
| `task` | Task management (create, list, update, transition) |
| `project` | Project management |
| `kanban` | Kanban board view |
| `status` | Vault health and statistics |

### Utilities

| Command | Description |
|---------|-------------|
| `template` | Manage document templates |
| `graph` | Show typed memory graph summary |
| `entities` | List all linkable entities |
| `link [file]` | Auto-link entity mentions |
| `compat` | Check OpenClaw compatibility |
| `embed` | Run qmd embedding for pending documents |

## Architecture

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

## OpenClaw Plugin Details

The plugin hooks into the OpenClaw lifecycle:

- **`before_agent_start`** — auto-recall: searches vault for context relevant to the current conversation and injects it
- **`message_received`** — auto-capture: observes incoming messages for durable information worth storing  
- **`agent_end`** — captures any final observations from the agent's response
- **`before_compaction`** — preserves important context before conversation compaction

Configuration in `openclaw.plugin.json`:

| Option | Default | Description |
|--------|---------|-------------|
| `vaultPath` | — | Path to vault directory |
| `collection` | `clawvault` | qmd search collection name |
| `autoRecall` | `true` | Inject memories before each turn |
| `autoCapture` | `true` | Auto-store from conversations |
| `recallLimit` | `5` | Max memories per recall |

## What Compounds

- **Decisions** accumulate into institutional knowledge
- **Lessons** prevent repeated mistakes  
- **Tasks** with transition ledgers track how work happened
- **Projects** group related work across hundreds of sessions
- **Wiki-links** build a knowledge graph that grows richer over time

The agent that runs for a year generates compounding value. Every lesson stored makes the next task cheaper.

## License

MIT
