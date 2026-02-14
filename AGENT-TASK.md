# Agent Task: Observer Auto-Task Detection (v2.4.0)

## Overview
Extend ClawVault's observation pipeline to automatically detect tasks, commitments, and TODOs from conversation transcripts. When the observer compresses a session, it should extract actionable items and route them to the task/backlog system.

## What Exists
- `src/observer/compressor.ts` — LLM-based session compression with `CRITICAL_RE`, `NOTABLE_RE` regex post-processing
- `src/observer/router.ts` — routes observations to vault categories based on type
- `src/lib/task-utils.ts` — task CRUD (createTask, listTasks, updateTask, completeTask)
- `src/commands/backlog.ts` — backlog management
- Tasks are markdown files in `tasks/` with frontmatter (status, owner, project, priority)
- Backlog items are markdown files in `backlog/`

## What to Build

### 1. Task Extraction in Compressor (`src/observer/compressor.ts`)

Add a new regex and LLM prompt extension to detect:
- Explicit TODOs: "TODO:", "we need to", "don't forget", "remember to", "make sure to"
- Commitments: "I'll", "I will", "let me", "going to", "plan to", "should"
- Unresolved questions: "need to figure out", "TBD", "to be determined"
- Deadlines: "by Friday", "before the demo", "deadline is"

New observation types to add: `task`, `todo`, `commitment-unresolved`

### 2. Auto-Route Tasks (`src/observer/router.ts`)

When an observation has type `task` or `todo`:
- Create a backlog item via `createTask()` from `src/lib/task-utils.ts` with status `open`
- Set `source: observer` in frontmatter to distinguish from manual tasks
- Include the original session context (which session, approximate timestamp)

When an observation has type `commitment-unresolved`:
- Check if a matching task/backlog item already exists (fuzzy title match)
- If not, create a backlog item flagged as `commitment`
- If it exists but is still open, update its `lastSeen` date

### 3. Dedup Logic

Before creating a task, check existing tasks/backlog for similar titles:
- Normalize: lowercase, strip punctuation, compare first 50 chars
- If >80% similar (simple Jaccard on words), skip creation and log a dedup hit
- This prevents "TODO: fix the tests" from creating 10 duplicate backlog items

### 4. New CLI Flag

Add `--extract-tasks` flag to `clawvault observe`:
- Default: true (always extract)
- `--no-extract-tasks` to disable
- When enabled, after compression, run task extraction on the observations

### 5. Tests

Add tests in `src/observer/compressor.test.ts`:
- Test TODO regex patterns detect all variants
- Test commitment regex patterns
- Test dedup logic
- Test that extracted tasks end up in backlog/

Add tests in `src/observer/router.test.ts`:
- Test task routing creates proper backlog files
- Test dedup prevents duplicates

## Reference Files
- Pattern to follow: `src/observer/compressor.ts` (existing regex + LLM flow)
- Task creation: `src/lib/task-utils.ts`
- Router: `src/observer/router.ts`
- Existing tests: `src/observer/compressor.test.ts`, `src/observer/router.test.ts`

## Constraints
- Zero new dependencies
- Must pass all existing tests (`npm test`)
- Don't modify task frontmatter schema — use existing fields
- Add `source` field to task frontmatter (string, e.g. "observer", "manual")
- TypeScript strict mode

## Build & Test
```bash
npm run build
npm test
```

## What Done Looks Like
1. `clawvault observe` on a session with "TODO: review the PR" creates a backlog item
2. Running observe twice on same session doesn't create duplicate tasks
3. Commitments like "I'll deploy tomorrow" get captured
4. All 346+ existing tests still pass + new tests added
5. `clawvault task list` shows observer-created tasks with `source: observer`
