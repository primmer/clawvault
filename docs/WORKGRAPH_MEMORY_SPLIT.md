# Workgraph vs ClawVault Memory — Separation Plan

This document clarifies the boundary between coordination primitives and memory primitives, and provides a migration path for mixed vaults created from older branches.

## Problem

Older vaults and prototypes often mixed:

- **Workgraph primitives** (`thread`, `space`, custom execution types)
- **Memory-system primitives** (broader memory categories, semantic retrieval concerns)

This created ambiguity about what should drive active multi-agent execution.

## Resolution

Use two distinct layers:

1. **`@clawvault/workgraph` (coordination substrate)**
   - claim/release/block/done lifecycle
   - append-only ledger and claim index
   - dynamic type registry for malleable typed primitives
   - agent-first JSON CLI

2. **`clawvault` (memory platform)**
   - long-term memory categories and semantic search workflows
   - observer/reflector/compression flows
   - broader vault operations

## Guarantees kept

- Dynamic typed primitives remain first-class (`primitive define`, runtime schema extension).
- Markdown-native storage remains unchanged.
- Coordination auditability remains via ledger entries.

## Migration checklist for mixed vaults

1. Create a dedicated coordination workspace:
   ```bash
   workgraph init ./coordination-space --json
   ```
2. Port active execution artifacts:
   - recreate spaces as `space` primitives
   - recreate active work as `thread` primitives
   - recreate domain-specific execution models via `primitive define`
3. Keep memory-only content outside the workgraph workspace.
4. Generate a command center note:
   ```bash
   workgraph command-center --output "ops/Command Center.md" --json
   ```
5. Route autonomous workers through:
   ```bash
   workgraph thread next --claim --actor <agent> --json
   ```

## Non-goal

`@clawvault/workgraph` does not replace memory retrieval systems; it replaces coordination ambiguity.
