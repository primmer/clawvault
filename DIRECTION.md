# ClawVault — Direction

## What It Is

Structured memory for AI agents. Typed markdown primitives that compound over time.

Every memory is a markdown file with YAML frontmatter. A task, a decision, a person, a lesson — each follows a schema defined in `templates/`. The agent reads and writes these files. The human browses them in Obsidian. No database. No vendor lock-in. Just files.

## One Package

```bash
npm i clawvault
```

You get:
- **The CLI** — `clawvault init`, `clawvault setup`, `clawvault search`, `clawvault task`
- **The OpenClaw plugin** — registers as memory slot, auto-captures observations, auto-recalls context
- **Templates** — malleable YAML schemas for all primitive types

One install. One package. Everything works.

## Malleable Primitives

Every primitive is defined by a template in `templates/`. Don't like the default task schema? Drop your own `task.md` in your vault's `templates/` directory. The agent reads YOUR schema, not ours.

Templates are YAML schema definitions:

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

Add fields. Remove fields. Create entirely new primitive types. The agent adapts.

## The Plugin

The OpenClaw plugin owns three things:

1. **Retrieval** — hybrid BM25 + vector search via qmd. When the agent asks "what do I know about X?", it gets the right answer.
2. **Session recap** — on wake, inject what matters: active tasks, recent decisions, key preferences, current focus. Reads from vault dynamically, not hardcoded paths.
3. **Auto-capture** — observe conversations, classify against template schemas, write typed primitives. The agent never calls `memory_store` — it just happens.

The plugin reads `templates/` on boot. Adding a new template = the plugin can create that type. No code changes needed.

## Onboarding

For new users: `clawvault init` creates a vault with default templates. Done.

For existing OpenClaw users: `clawvault setup --from ~/.openclaw/workspace` scans existing memory files (MEMORY.md, daily logs, SOUL.md, USER.md), extracts people, preferences, decisions, and tasks, then creates typed vault primitives. The agent bootstraps its own vault from what it already knows.

## Obsidian as Control Plane

Every primitive is a markdown file. Your vault IS an Obsidian vault. Tasks are Kanban boards. Decisions are searchable. The knowledge graph grows with every interaction. No custom UI needed — Obsidian's ecosystem already renders everything.

Five generated Bases views out of the box:
- All tasks
- Blocked items
- By project
- By owner
- Backlog

## Multi-Agent Collaboration

Two agents sharing a vault share a world. Agent A creates a task. Agent B picks it up. Agent A makes a decision. Agent B reads it and adjusts. No message passing. No API. The filesystem is the message bus.

## What Compounds

- **Decisions** accumulate into institutional knowledge
- **Lessons** prevent repeated mistakes
- **Tasks** with transition ledgers track how work happened
- **Projects** group related work across hundreds of sessions
- **Wiki-links** build a knowledge graph that grows richer over time

The agent that runs for a year generates compounding value. Every lesson stored makes the next task cheaper.

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

## Priority

1. Plugin perfection (the thing users interact with)
2. Onboarding (setup command for new + existing users)
3. Template malleability (user-defined schemas)
4. Obsidian integration
5. Multi-agent vault sharing
