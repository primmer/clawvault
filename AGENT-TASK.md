# ClawVault v2.3.0: Task Tracking + Canvas Dashboard

Build task tracking primitives and an Obsidian Canvas dashboard generator for ClawVault.

## The Vision

ClawVault becomes the single source of truth for what needs to get done across a business. Humans and agents both have tasks. Everything is visible in an Obsidian Canvas dashboard. An agent says "add this to the backlog" and it appears. The canvas regenerates to show the current state.

## Component 1: Task Primitives

### New vault categories
Add these to DEFAULT_CATEGORIES in src/types.ts:
- `tasks` — active work items
- `backlog` — ideas and future work

### Task file format
Tasks are markdown files in `tasks/` with frontmatter:

```markdown
---
status: open | in-progress | blocked | done
owner: pedro
project: clawvault
priority: critical | high | medium | low
blocked_by: gemini-api-timeout
due: 2026-02-15
created: 2026-02-14T02:15:00Z
updated: 2026-02-14T02:15:00Z
tags: [engineering, v2.3.0]
---
# Fix Gemini API timeout on large sessions

Compressor stalls on sessions >5MB. Needs timeout + retry in callGemini().

## Notes
- Affects observation backlog (118 sessions remaining)
- Consider chunking large sessions before sending
```

### Backlog file format
Backlog items are simpler — just captured ideas:

```markdown
---
source: pedro
project: clawvault
created: 2026-02-14T02:15:00Z
tags: [feature]
---
# Add trust scoring to observations

Track trust/reliability per source agent. Decay over time.
Inspired by BrainMeld's trust weight reinforcement concept.
```

### New commands

#### `clawvault task` — Task management
```bash
# Add a task
clawvault task add "Fix Gemini timeout" --owner clawdious --project clawvault --priority high
clawvault task add "Send Chamath email" --owner pedro --priority critical --due 2026-02-15

# List tasks
clawvault task list                          # All open/in-progress tasks
clawvault task list --owner pedro            # Pedro's tasks
clawvault task list --owner roman            # Roman's tasks  
clawvault task list --status blocked         # All blocked tasks
clawvault task list --project hale-pet-door  # Tasks for a project
clawvault task list --priority critical      # Critical only

# Update a task
clawvault task update fix-gemini-timeout --status in-progress
clawvault task update fix-gemini-timeout --status blocked --blocked-by "gemini-rate-limits"
clawvault task done fix-gemini-timeout       # Mark done (moves to done status, adds completed date)

# Show task details
clawvault task show fix-gemini-timeout
```

Output format for `task list` should be clean terminal table:
```
STATUS      OWNER       PRIORITY  PROJECT          TITLE
■ blocked   clawdious   high      clawvault        Fix Gemini API timeout
● active    pedro       critical  versatly         Send Chamath email  
● active    roman       medium    hale-pet-door    Bug report follow-up
○ open      eli         low       clawvault        Trust scoring research
```

Status icons: ● active/in-progress, ■ blocked, ○ open, ✓ done

#### `clawvault backlog` — Quick capture
```bash
# Add to backlog
clawvault backlog "Add trust scoring to observations" --project clawvault --source pedro
clawvault backlog "Obsidian plugin for live graph" --project clawvault
clawvault backlog "Roman needs access to staging" --project hale-pet-door --source clawdious

# List backlog
clawvault backlog list                       # All items
clawvault backlog list --project clawvault   # By project

# Promote backlog item to task
clawvault backlog promote trust-scoring --owner clawdious --priority medium
```

#### `clawvault blocked` — Quick blocker view
```bash
clawvault blocked                # Show all blocked tasks with what's blocking them
clawvault blocked --project X    # Blocked tasks for a project
```

Output:
```
BLOCKED TASKS (3)

■ Fix Gemini API timeout (clawdious, clawvault)
  Blocked by: gemini-rate-limits
  Since: 2026-02-13

■ Deploy ClawVault Cloud (pedro, clawvault-cloud)
  Blocked by: railway-deployment-config
  Since: 2026-02-10

■ Roman's bug report (roman, hale-pet-door)
  Blocked by: awaiting-details
  Since: 2026-02-12
```

### Implementation
```
src/commands/task.ts          — task add/list/update/done/show
src/commands/task.test.ts
src/commands/backlog.ts       — backlog add/list/promote  
src/commands/backlog.test.ts
src/commands/blocked.ts       — blocked view
src/commands/blocked.test.ts
src/lib/task-utils.ts         — shared task file read/write/query helpers
src/lib/task-utils.test.ts
```

Task files are stored as: `tasks/<slugified-title>.md`
Backlog files are stored as: `backlog/<slugified-title>.md`
Slugify: lowercase, replace spaces with hyphens, remove special chars.

When a task is marked done, add `completed: <ISO date>` to frontmatter but keep the file in tasks/ (don't move it). Use the `status: done` field to filter.

## Component 2: Canvas Dashboard Generator

### Command: `clawvault canvas`
```bash
clawvault canvas -v <vault-path> [--output <path>]
```

Default output: `dashboard.canvas` in the vault root.

### Canvas Layout

The dashboard canvas should look like this (inspired by BrainMeld's brain-architecture canvas):

```
+--LEFT SIDE (x: 0-500)-------------------------+--RIGHT SIDE (x: 550-1400)------------------+
|                                                |                                             |
|  [GROUP: "🧠 Knowledge Graph"]                |  [GROUP: "● Active Tasks"]                  |
|  - Stats text node (nodes, edges, files)       |  - One text node per active task             |
|  - Top 10 entities as small text nodes         |  - Color by priority (1=critical, 2=high,   |
|  - Recent decisions (last 5)                   |    3=medium, no color=low)                  |
|  - Wiki-link connections between entities      |  - Shows: title, owner, project              |
|                                                |  - Uses file nodes pointing to task files    |
|                                                |                                             |
|  [GROUP: "📊 Vault Stats"]                    |  [GROUP: "■ Blocked"]                       |
|  - Category breakdown                          |  - One text node per blocked task            |
|  - Recent observations (scored format)         |  - Red color ("1")                           |
|  - Open loops from latest reflection           |  - Shows: what's blocking, since when        |
|                                                |                                             |
|                                                |  [GROUP: "📋 Backlog"]                      |
|                                                |  - Backlog items as small text nodes         |
|                                                |  - Grouped by project if >5 items            |
|                                                |                                             |
|                                                |  [GROUP: "✓ Recently Done"]                 |
|                                                |  - Last 10 completed tasks                   |
|                                                |  - Green color ("4"), faded                  |
+------------------------------------------------+---------------------------------------------+

[BOTTOM: Data Flow diagram]
- Text node showing: Session → Observe → Score → Route → Reflect → Promote pipeline
- Edges connecting the flow steps
```

### Canvas Generation Rules

1. **Use file nodes** for tasks and backlog items — clicking opens the actual file in Obsidian
2. **Use text nodes** for computed content (stats, graphs, data flow)
3. **Use group nodes** to organize sections
4. **Color coding:**
   - Critical tasks: "1" (red)
   - High priority: "2" (orange)  
   - Medium: "3" (yellow)
   - Low: no color
   - Blocked: "1" (red)
   - Done: "4" (green)
   - Knowledge graph group: "6" (purple)
   - Stats group: "5" (cyan)
5. **Node IDs:** 16-character lowercase hex strings (generate with crypto.randomBytes(8).toString('hex'))
6. **Layout:** x increases right, y increases down. Groups at least 50px apart. Nodes 20-40px padding inside groups.
7. **Edges:** Connect blocked tasks to their blocker. Connect tasks to their project entity if it exists as a graph node.

### JSON Canvas Format Reference

The output must be valid JSON Canvas (jsoncanvas.org/spec/1.0/):
```json
{
  "nodes": [
    {"id": "hex16", "type": "text|file|group", "x": 0, "y": 0, "width": 300, "height": 100, "text": "...", "color": "1-6 or #hex"},
    {"id": "hex16", "type": "file", "x": 0, "y": 0, "width": 300, "height": 100, "file": "tasks/my-task.md"},
    {"id": "hex16", "type": "group", "x": 0, "y": 0, "width": 500, "height": 400, "label": "Group Name", "color": "4"}
  ],
  "edges": [
    {"id": "hex16", "fromNode": "id", "fromSide": "right", "toNode": "id", "toSide": "left", "label": "optional", "color": "1-6"}
  ]
}
```

Node types:
- `text`: has `text` field (markdown string, `\n` for newlines)
- `file`: has `file` field (path relative to vault root)
- `group`: has optional `label` field, contains other nodes by position
- Colors: "1"=red, "2"=orange, "3"=yellow, "4"=green, "5"=cyan, "6"=purple

### Implementation
```
src/commands/canvas.ts        — Canvas generator
src/commands/canvas.test.ts
src/lib/canvas-layout.ts      — Layout helpers (positioning, grouping)
src/lib/canvas-layout.test.ts
```

## Build & Ship

1. Add `tasks` and `backlog` to DEFAULT_CATEGORIES in src/types.ts
2. Implement all commands
3. Register in CLI entry point (check bin/ directory for pattern)
4. Bump version to 2.3.0 in package.json
5. All existing tests must pass + new tests
6. `npm run build` must succeed
7. Update CHANGELOG.md

## Constraints
- **Zero new runtime dependencies** — Node.js built-in only (crypto, fs, path, child_process)
- TypeScript strict mode, ESM ("type": "module")
- Follow existing patterns in src/commands/ (see status.ts for simple, observe.ts for complex)
- Follow existing store/read patterns in src/lib/vault.ts
- Don't modify existing tests
- All file operations use the vault path from -v flag or CLAWVAULT_PATH env
- Wiki-link task owners and projects: `[[pedro]]`, `[[clawvault]]` in content
- Task slugs must be deterministic (same title = same slug = same filename)

## Reference Files
- Types + categories: src/types.ts (DEFAULT_CATEGORIES array)
- Vault operations (store/read): src/lib/vault.ts
- Memory graph: src/lib/memory-graph.ts
- Observation reader: src/lib/observation-reader.ts
- Observation format: src/lib/observation-format.ts
- Ledger (reflections): src/lib/ledger.ts
- Context profiles: src/lib/context-profile.ts
- CLI registration: bin/ directory (check all files for command registration pattern)
- Config: src/lib/config.ts
- Example simple command: src/commands/status.ts
- Example complex command: src/commands/observe.ts
