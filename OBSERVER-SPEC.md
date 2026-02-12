# ClawVault Observational Memory — Spec

## Core Idea
ClawVault gets a background observer that watches agent conversations and auto-compresses them into structured observations. Text-based, no vector DB, prompt-cacheable.

Inspired by Mastra's observational memory (94.87% LongMemEval) but filesystem-native.

## Architecture

```
Agent Session (OpenClaw)
  │
  ├─ writes to session file (conversation)
  │
  └─ clawvault observe --watch <session-path>
       │
       ├─ Watches file for changes (fs.watch / polling)
       ├─ Accumulates raw messages in buffer
       │
       ├─ When buffer hits TOKEN_THRESHOLD (default 30k):
       │   └─ Observer Agent compresses → observations
       │       └─ Appends to vault/observations/YYYY-MM-DD.md
       │
       └─ When observations hit REFLECT_THRESHOLD (default 40k):
           └─ Reflector Agent garbage-collects stale observations
```

## Observation Format (Mastra-compatible but filesystem-native)

```markdown
## 2026-02-11

🔴 14:10 User decided to use PostgreSQL for ClawVault Cloud (rationale: managed, scalable)
🔴 14:12 API key hashing uses SHA-256 with prefix stored separately  
🟡 14:15 Dashboard uses Next.js 14 + shadcn/ui + Tailwind
🟢 14:20 Considered MongoDB but rejected due to query complexity
🔴 14:30 Railway deployment requires --accept-data-loss for schema migrations
```

Priority levels:
- 🔴 Critical — decisions, errors, user preferences, blockers
- 🟡 Notable — context, patterns, frequently referenced
- 🟢 Info — general observations, background details

## New Commands

### `clawvault observe`
Start the observer daemon.

```bash
# Watch a specific session file
clawvault observe --watch /path/to/session.jsonl

# Watch stdin (pipe mode)
cat conversation.txt | clawvault observe --pipe

# One-shot: compress a conversation into observations
clawvault observe --compress /path/to/conversation.md

# Configure thresholds
clawvault observe --watch <path> --threshold 30000 --reflect-threshold 40000

# Run as background daemon
clawvault observe --daemon --watch /path/to/sessions/
```

### `clawvault context` (enhanced)
```bash
# Existing: inject relevant context
clawvault context "working on Hale project"

# New: with token budget
clawvault context "working on Hale" --budget 4000

# New: use cached profile
clawvault context --profile hale-dev

# New: include observations
clawvault context "deploy ClawVault Cloud" --include-observations
```

### `clawvault profile`
```bash
# Create a reusable context profile
clawvault profile create "hale-dev" --query "Hale Pet Door development"

# List profiles  
clawvault profile list

# Inject profile
clawvault profile inject "hale-dev" --budget 8000
```

## Implementation Plan

### Phase 1: Observer Core
- `src/observer/observer.ts` — main observer class
- `src/observer/compressor.ts` — LLM-powered message compression
- `src/observer/reflector.ts` — garbage collection of stale observations  
- `src/observer/watcher.ts` — file watcher for session files
- `src/commands/observe.ts` — CLI command

### Phase 2: Token-Budget Context
- Enhance `src/commands/context.ts` with `--budget` flag
- Token counting (tiktoken or simple estimate)
- Priority-based retrieval: recent > high-relevance > observations

### Phase 3: Context Profiles
- `src/commands/profile.ts` — create/list/inject profiles
- Store in `vault/.profiles/`

## Key Differences from Mastra
1. **Filesystem-native** — observations stored as markdown files, not in-memory
2. **Zero-impact** — separate daemon, doesn't touch agent context window
3. **Portable** — observations are plain text, work with any LLM
4. **Git-compatible** — observations are diffable, version-controlled
5. **Cross-session** — observer can watch multiple sessions, build org-wide memory
