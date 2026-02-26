# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

ClawVault is a structured persistent memory system for AI agents. It stores memories as Obsidian-compatible markdown files. See `README.md` for full documentation.

### Development commands

Standard commands are in `package.json` scripts:

- `npm install` — install dependencies
- `npm run build` — compile TypeScript via tsup (required before `bin/` tests pass)
- `npm run typecheck` — type-check without emitting
- `npm test` — run vitest (564 tests across 79 files)
- `npm run dev` — watch mode build (tsup)
- `npm run ci` — typecheck + test + build

### Key gotchas

- **Build before testing**: 8 test suites under `bin/` import from `dist/` and will fail unless you run `npm run build` first. The remaining 71 test files work without a build.
- **ESLint not installed**: `npm run lint` is defined but ESLint is not in `devDependencies`. Running it gives `eslint: not found`. This is an upstream gap, not an environment issue.
- **`qmd` external dependency**: The CLI requires `qmd` (BM25/vector search engine) on `PATH` for vault operations (`init`, `search`, `context`, etc.). Tests gracefully skip `qmd`-dependent paths when it is absent. To install: `bun install -g github:tobi/qmd` then build it and link the binary. The `qmd` binary must also be trusted via `bun pm trust` since postinstalls are blocked by default.
- **Dashboard**: `node dashboard/server.js --vault <path>` starts a web dashboard on port 3377 (Express + WebSocket + force-graph).
- **LLM API keys optional**: Observer/reflector/compressor features require API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) but are not needed for core CLI or testing.

### Workgraph substrate (v3)

The workgraph substrate lives in `src/workgraph/` and was introduced via PR #64. Key modules:

- `src/workgraph/primitive-registry.ts` — typed primitive definitions loaded from `templates/primitive-registry.yaml`
- `src/workgraph/event-ledger.ts` — monotonic event ledger with crash-recovery resume tokens
- `src/workgraph/store.ts` — workgraph persistence layer
- `src/workgraph/writer-policy.ts` — access control for who can write to which primitives
- `src/workgraph/schema-contract.ts` — field-level schema validation at write time
- `src/runtime/` — OpenClaw and Claude Code runtime adapters for event normalization
- `shared/` — constants (registry limits, identifier rules, reserved fields, v3 command surface, removed v3 primitives)
- `packages/obsidian/` — Obsidian "Control Plane" plugin (graph, workstreams board, ops rail)

The workgraph code imports from `../../shared/` relative paths. If you add new shared modules, place them in `/workspace/shared/` with both `.js` and `.d.ts` files.

### Obsidian visualization

Obsidian AppImage is at `/tmp/Obsidian.AppImage` (extracted to `/tmp/squashfs-root/`). Launch with `--no-sandbox --disable-gpu-sandbox`. The vault at `/tmp/workgraph-vault` is pre-configured. To install the ClawVault Control Plane plugin, copy `packages/obsidian/` files into `.obsidian/plugins/clawvault-control-plane/` within the vault. The plugin reads from `.clawvault/control-plane/snapshot.json`.
