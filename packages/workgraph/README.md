# @clawvault/workgraph

Agent-first workgraph workspace for multi-agent collaboration.

`@clawvault/workgraph` is the coordination core extracted from ClawVault. It focuses only on:

- Dynamic primitive registry (`thread`, `space`, `decision`, `lesson`, `fact`, `agent`, plus custom types)
- Append-only event ledger (`.clawvault/ledger.jsonl`)
- Markdown-native primitive store
- Thread lifecycle coordination (claim/release/block/unblock/done/decompose)
- JSON-friendly CLI for agent orchestration

No memory-category scaffolding, no qmd dependency, no observational-memory pipeline.

## Install

```bash
npm install @clawvault/workgraph
```

Or global CLI:

```bash
npm install -g @clawvault/workgraph
```

## Agent-first CLI

```bash
# Initialize pure workgraph workspace
workgraph init ./wg-space --json

# Define custom primitive
workgraph primitive define command-center \
  --description "Agent ops cockpit" \
  --fields owner:string \
  --fields panel_refs:list \
  --json

# Create and route thread work
workgraph thread create "Ship command center" \
  --goal "Production-ready multi-agent command center" \
  --priority high \
  --actor agent-lead \
  --json

workgraph thread next --claim --actor agent-worker --json
workgraph ledger show --count 20 --json
```

### JSON contract

All commands support `--json` and emit:

- Success: `{ "ok": true, "data": ... }`
- Failure: `{ "ok": false, "error": "..." }` (non-zero exit)

This is intended for robust parsing by autonomous agents.

## Programmatic API

```ts
import { registry, thread, store, ledger, workspace } from '@clawvault/workgraph';

workspace.initWorkspace('/tmp/wg');

registry.defineType('/tmp/wg', 'milestone', 'Release checkpoint', {
  thread_refs: { type: 'list', default: [] },
  target_date: { type: 'date' },
}, 'agent-architect');

const t = thread.createThread('/tmp/wg', 'Build Auth', 'JWT and refresh flow', 'agent-lead');
thread.claim('/tmp/wg', t.path, 'agent-worker');
thread.done('/tmp/wg', t.path, 'agent-worker', 'Shipped');
```

## Publish (package-only)

From this directory:

```bash
npm run ci
npm publish --access public
```

## Skill guide

See `SKILL.md` for the full operational playbook optimized for autonomous agents (including pi-mono compatibility guidance).
