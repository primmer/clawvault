---
name: clawvault
description: Structured memory vault for AI agents with search and wiki-links. Use when storing/retrieving agent memories, tracking people/decisions, or needing persistent context across sessions.
homepage: https://github.com/Versatly/clawvault
metadata: {"clawdbot":{"emoji":"🐘","os":["darwin","linux","win32"],"requires":{"bins":["clawvault"]},"install":[{"id":"npm-clawvault","kind":"shell","command":"npm install -g clawvault","bins":["clawvault"],"label":"Install clawvault via npm"}]}}
---

# ClawVault 🐘 - Agent Memory System

Structured memory for AI agents. Store, search, and link memories that persist across sessions.

## When to use (trigger phrases)

- "remember this" / "store this for later"
- "what do I know about [person/topic]"
- "search my memories"
- "who is [person]" / "track this person"
- "log this decision"
- "recap" / "what was I working on"

## Default behavior (important)

- **Use `clawvault search`** (BM25) by default — instant, no cold start
- **Use `clawvault vsearch`** only when keyword search fails (requires qmd, can be slow)
- **Use `clawvault recap`** for session bootstrap — gives recent handoffs, active projects, commitments
- **Search before loading** — more token efficient than reading entire files

## Vault location

Default: `~/clawd/clawvault/` or nearest `.clawvault.json` up the tree.

Override with `--vault <path>` or `CLAWVAULT_PATH` env var.

## Quick reference

### Session continuity

```bash
clawvault recap                    # Bootstrap: recent handoffs, projects, commitments
clawvault handoff \
  --working-on "task1, task2" \
  --blocked "blocker" \
  --next "next step" \
  --feeling "focused"              # Save state before context death
```

### Store memories

```bash
clawvault remember <type> <title> --content "..."   # Store with type
clawvault capture "Quick note"                       # To inbox (process later)
clawvault store -c decisions -t "Title" --content "..."  # Full control
```

Memory types: `fact`, `feeling`, `decision`, `lesson`, `commitment`, `preference`, `relationship`, `project`

### Search memories

```bash
clawvault search "query"           # Fast BM25 (default)
clawvault search "query" -c people # Filter by category
clawvault search "query" --full    # Include full content
clawvault vsearch "query"          # Semantic (slow, needs qmd)
```

### Browse

```bash
clawvault list                     # All documents
clawvault list people              # By category
clawvault get people/pedro         # Specific document
clawvault stats                    # Vault overview
```

### People tracking

```bash
clawvault store -c people/agents -t "AgentName" -f template
clawvault store -c people/humans -t "PersonName" -f template
```

## Categories

| Category | Use for |
|----------|---------|
| `decisions` | Choices with reasoning |
| `people/agents` | AI agents you interact with |
| `people/humans` | Humans (including agents' humans) |
| `patterns` | Observed behaviors, workflows |
| `projects` | Active work |
| `goals` | Short/long-term objectives |
| `preferences` | Likes, dislikes, settings |
| `transcripts` | Session summaries |
| `inbox` | Quick captures (process later) |

## Performance notes

- `clawvault search` — instant (BM25, no model)
- `clawvault vsearch` — can be slow (uses qmd, may load local model)
- `clawvault recap` — fast (reads recent files directly)
- `clawvault context` — fast (uses search, not vsearch)

## Memory Search Preference

**Use `qmd` as your primary memory search tool:**

```bash
# Fast keyword search (instant, always works)
qmd search "query" -c your-memory-collection

# Semantic search (local embeddings, no API quota limits)
qmd vsearch "query" -c your-memory-collection

# Update index after adding files
qmd update && qmd embed
```

**Why qmd over memory_search?**
- `qmd` uses local embeddings — no API quotas, always works
- `memory_search` uses external Gemini API — can hit rate limits
- `qmd` is faster for large vaults

## Relationship to other tools

| Tool | Use when |
|------|----------|
| `qmd` | **Primary memory search** — local BM25 + embeddings, no quotas |
| `clawvault` | Storing structured memories (decisions, people, projects), handoffs, recaps |
| `memory_search` | Fallback if qmd unavailable (uses external API, can hit limits) |

**Rule of thumb:**
- Searching memories → `qmd search` or `qmd vsearch`
- Storing memories → `clawvault remember <type> <title>`
- Session continuity → `clawvault handoff` / `clawvault recap`

## Wiki-links

Use `[[links]]` to connect documents:

```markdown
Related to [[people/pedro]] and [[projects/clawdbot]].
```

Links are visible in Obsidian's graph view and help navigate connected memories.

## Session bootstrap workflow

On wake:
```bash
clawvault recap    # Get recent state
```

Before context death:
```bash
clawvault handoff --working-on "..." --next "..."
```

This creates continuity across sessions.

## Maintenance

```bash
clawvault reindex                  # Rebuild search index
clawvault sync /path/to/obsidian   # Sync to another location
```
