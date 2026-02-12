# ClawVault™ 🐘

**An elephant never forgets.**

Structured memory system for AI agents. Store, search, and link memories across sessions.

🌐 **Website:** [clawvault.dev](https://clawvault.dev) | 📦 **npm:** [clawvault](https://www.npmjs.com/package/clawvault) | 🛠️ **ClawHub:** [clawvault skill](https://clawhub.com/skills/clawvault)

> **Built for [OpenClaw](https://openclaw.ai)** — the AI agent framework. Works standalone too.

## Install for OpenClaw Agents

```bash
# Install the skill (recommended for OpenClaw agents)
clawhub install clawvault

# Or install the CLI globally
npm install -g clawvault
```

## Requirements

- **Node.js 18+**
- **[qmd](https://github.com/Versatly/qmd)** — Local semantic search (required)

```bash
# Install qmd first
bun install -g qmd   # or: npm install -g qmd

# Then install clawvault
npm install -g clawvault
```

## Why ClawVault?

AI agents forget things. Context windows overflow, sessions end, important details get lost. ClawVault fixes that:

- **Structured storage** — Organized categories, not random notes
- **Local search** — qmd provides BM25 + semantic search with local embeddings (no API quotas)
- **Wiki-links** — `[[connections]]` visible in Obsidian's graph view
- **Session continuity** — Handoff/recap system for context death
- **Token efficient** — Search instead of loading entire memory files

## Quick Start

```bash
# Initialize vault with qmd collection
clawvault init ~/memory --qmd-collection my-memory

# Store memories
clawvault remember decision "Use qmd" --content "Local embeddings, no API limits"
clawvault remember lesson "Context death is survivable" --content "Write it down"
clawvault capture "Quick note to process later"

# Search (uses qmd)
clawvault search "decision"           # BM25 keyword search
clawvault vsearch "what did I decide" # Semantic search

# Session management
clawvault wake
clawvault sleep "build wake/sleep commands" --next "run doctor"
clawvault handoff --working-on "task1" --next "task2"   # Manual handoff (advanced)
clawvault recap                                         # Manual recap (advanced)
```

**Tip:** Set `CLAWVAULT_PATH` to skip directory walk (or use `shell-init`):
```bash
echo 'export CLAWVAULT_PATH="$HOME/memory"' >> ~/.bashrc
eval "$(clawvault shell-init)"
```

## Observational Memory

Automatically compress conversations into prioritized observations:

```bash
# One-shot: compress a conversation file
clawvault observe --compress session.md

# Watch mode: monitor a directory for new session files
clawvault observe --watch ./sessions/

# Background daemon
clawvault observe --daemon
```

Observations use emoji priorities:
- 🔴 **Critical** — decisions, errors, blockers, deadlines
- 🟡 **Notable** — preferences, architecture discussions, people interactions
- 🟢 **Info** — routine updates, deployments, general progress

Critical and notable observations are automatically routed to vault categories (`decisions/`, `lessons/`, `people/`, etc.). The system uses LLM compression (Gemini, Anthropic, or OpenAI) with a rule-based fallback.

Integrated into the sleep/wake lifecycle:
```bash
clawvault sleep "task summary" --session-transcript conversation.md
# → observations auto-generated and routed

clawvault wake
# → recent 🔴/🟡 observations included in context
```

Token-budget-aware context injection:
```bash
clawvault context "what decisions were made" --budget 2000
# → fits within token budget, 🔴 items first
```

## ClawVault Cloud

ClawVault Cloud extends local memory with org-linked decision traces. The local vault stays your source of truth, and cloud sync adds cross-agent visibility plus centralized audit trails.

- **Local-first writes** - `trace emit` always appends locally before sync attempts.
- **Queued and retryable sync** - traces are buffered and sent with `clawvault sync`.
- **Org-linked vault identity** - each vault can be linked once, then monitored with status checks.
- **Backwards-compatible sync command** - `clawvault sync <target>` still syncs vault files to a folder.

Quick setup:

```bash
# 1) Save your cloud API key
clawvault config --cloud-key cvk_xxx

# 2) Link this local vault to your org
clawvault org link --vault ~/memory

# 3) Verify cloud + org link state
clawvault org status

# 4) Emit trace events and sync queued traces
clawvault trace emit --summary "Approved 20% discount for ACME"
clawvault sync
```

## Search

Use `clawvault search` / `qmd` for vault search — it indexes the **entire vault** (decisions/, people/, lessons/, observations/, etc.).

OpenClaw's built-in `memory_search` only indexes `MEMORY.md` + `memory/**/*.md`. If your vault lives inside `memory/`, it'll work. If your vault is elsewhere, `memory_search` won't find your ClawVault categories.

```bash
# Full vault search (recommended)
clawvault search "query"              # BM25 keyword
clawvault vsearch "what did I decide" # Semantic (local embeddings)

# OpenClaw memory search (only MEMORY.md + memory/*.md)
# Works if vault is inside memory/, misses vault categories otherwise
```

## Vault Structure

```
my-memory/
├── .clawvault.json      # Config (includes qmd collection name)
├── decisions/           # Choices with reasoning
├── lessons/             # Things learned
├── people/              # One file per person
├── projects/            # Active work
├── commitments/         # Promises and deadlines
├── inbox/               # Quick capture (process later)
└── handoffs/            # Session continuity
```

## Commands

### Store Memories

```bash
# With type classification (recommended)
clawvault remember <type> <title> --content "..."
# Types: decision, lesson, fact, commitment, project, person

# Quick capture
clawvault capture "Note to self"

# Manual store
clawvault store -c decisions -t "Title" --content "..."
```

**Note:** All write commands auto-update the qmd index. Use `--no-index` to skip.

### Search

```bash
clawvault search "query"           # BM25 keyword
clawvault search "query" -c people # Filter by category
clawvault vsearch "query"          # Semantic (local embeddings)
```

### Browse

```bash
clawvault list                # All documents
clawvault list decisions      # By category
clawvault get decisions/title # Specific document
clawvault stats               # Vault overview
```

### Session Continuity

```bash
# Start a session (recover + recap + summary)
clawvault wake

# End a session with a handoff
clawvault sleep "building CRM, fixing webhook" \
  --blocked "waiting for API key" \
  --next "deploy to production" \
  --decisions "chose Supabase over Firebase" \
  --feeling "focused"

# Manual tools (advanced)
clawvault handoff --working-on "task1" --next "task2"
clawvault recap --brief   # Token-efficient recap

# Health check
clawvault doctor
```

### Cloud Sync

```bash
# Configure cloud API access
clawvault config --cloud-key cvk_xxx
clawvault config --cloud-api-url https://api.clawvault.dev # optional override

# Link local vault to cloud org/vault ID
clawvault org link --vault ~/memory
clawvault org status

# Emit decision traces (summary-only or JSON payload)
clawvault trace emit --summary "Approved 20% discount for ACME"
clawvault trace emit --trace-file ./trace.json

# Sync queued cloud traces (no target argument)
clawvault sync
clawvault sync --all
clawvault sync --limit 25

# Existing file sync still works when target is provided
clawvault sync ./obsidian   # existing file sync to target folder
```

## Agent Setup (AGENTS.md)

Add this to your `AGENTS.md` to ensure proper memory habits:

```markdown
## Memory

**Write everything down. Memory doesn't survive session restarts.**

### Search (use qmd, not memory_search)
\`\`\`bash
qmd search "query" -c your-memory    # Fast keyword
qmd vsearch "query" -c your-memory   # Semantic
\`\`\`

### Store
\`\`\`bash
clawvault remember decision "Title" --content "..."
clawvault remember lesson "Title" --content "..."
\`\`\`

### Session Start
\`\`\`bash
clawvault wake
\`\`\`

### Session End
\`\`\`bash
clawvault sleep "..." --next "..."
\`\`\`

### Checkpoint (during heavy work)
\`\`\`bash
clawvault checkpoint --working-on "..." --focus "..." --blocked "..."
\`\`\`

```

## Templates

ClawVault includes templates for common memory types:

- `decision.md` — Choices with context and reasoning
- `lesson.md` — Things learned
- `person.md` — People you work with
- `project.md` — Active work
- `handoff.md` — Session state before context death
- `daily.md` — Daily notes

Use with: `clawvault store -c category -t "Title" -f decision`

## Library Usage

```typescript
import { ClawVault, createVault, findVault } from 'clawvault';

const vault = await createVault('./memory', { qmdCollection: 'my-memory' });

await vault.store({
  category: 'decisions',
  title: 'Use ClawVault',
  content: 'Decided to use ClawVault for memory.',
});

const results = await vault.find('memory', { limit: 5 });
```

## License

MIT

---

*"An elephant never forgets." — Now neither do you.* 🐘
