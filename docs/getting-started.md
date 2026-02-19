# Getting Started with ClawVault

## What is ClawVault?

ClawVault is a structured memory system for AI agents. It stores knowledge as typed markdown files — tasks, decisions, lessons, people, projects — each with YAML frontmatter following a schema. Agents read and write these files. Humans browse them in Obsidian.

## Installation

### Option A: OpenClaw Plugin (recommended)

If you're running [OpenClaw](https://openclaw.ai):

```bash
openclaw plugins install clawvault
```

Then configure your vault path:

```bash
openclaw config set plugins.clawvault.config.vaultPath ~/my-vault
```

Restart the gateway:

```bash
openclaw gateway restart
```

ClawVault will now:
- Auto-recall relevant memories before each agent turn
- Auto-capture important information from conversations
- Provide `memory_search`, `memory_store`, `memory_get`, `memory_forget` tools

### Option B: Standalone CLI

```bash
npm install -g clawvault
```

## Creating Your First Vault

```bash
clawvault init ~/my-vault --name my-brain
```

This creates:
- Default templates in `templates/`
- A `.clawvault.json` config file
- The vault directory structure

## Setting Up Obsidian Views

If you use Obsidian, run setup to create Bases views:

```bash
cd ~/my-vault
clawvault setup
```

This generates five views:
- **All Tasks** — every task across projects
- **Blocked** — items needing attention
- **By Project** — tasks grouped by project
- **By Owner** — tasks grouped by assignee
- **Backlog** — unstarted work

## Your First Memory

### Via CLI

```bash
cd ~/my-vault
clawvault store
```

Follow the prompts to create a typed memory document.

### Via the Plugin

If using the OpenClaw plugin, memories are captured automatically from conversations. You can also use the tools directly:

- `memory_store` — save a fact, preference, or decision
- `memory_search` — find relevant memories
- `memory_get` — check vault status or list preferences
- `memory_forget` — remove outdated memories

## Searching

```bash
# Keyword search (BM25)
clawvault search "deployment architecture"

# Semantic search (vector similarity)
clawvault vsearch "how do we handle auth?"
```

Both require `qmd` installed and on your PATH.

## Session Lifecycle

For agents with long-running sessions:

```bash
# Start of session — recover state, generate recap
clawvault wake

# During heavy work — save checkpoint
clawvault checkpoint

# End of session — create handoff for next session
clawvault sleep "completed auth refactor, tests passing"
```

## Next Steps

- [Templates Guide](./templates.md) — customize schemas
- [Plugin Configuration](./plugin.md) — tune auto-recall and auto-capture
- [CLI Reference](./cli-reference.md) — full command documentation
- [Architecture](./architecture.md) — how it all fits together
