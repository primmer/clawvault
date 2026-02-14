# ClawVault v2.3.0: Canvas Export + MCP Server + Obsidian CLI Integration

Build three new features for ClawVault as a proper version bump (v2.3.0).

## Component 1: `clawvault canvas` command

Generates Obsidian-compatible JSON Canvas files (`.canvas`) from the vault's memory graph.

### JSON Canvas Spec (from jsoncanvas.org/spec/1.0/)

The `.canvas` file format has two top-level arrays: `nodes` and `edges`.

**Node types:** `text`, `file`, `link`, `group`

All nodes have: `id` (16-char hex string), `type`, `x`, `y`, `width`, `height`, optional `color` (preset "1"-"6" or hex).

- **text nodes:** `{ "text": "Markdown content" }` — newlines as `\n` in JSON
- **file nodes:** `{ "file": "path/to/file.md", "subpath": "#heading" }` — references vault files
- **link nodes:** `{ "url": "https://..." }`
- **group nodes:** `{ "label": "Group Name" }` — visual containers, other nodes inside by position

**Edges:** `{ "id", "fromNode", "toNode", "fromSide?", "toSide?", "color?", "label?" }`
- Sides: "top", "right", "bottom", "left"
- Colors: "1"=red, "2"=orange, "3"=yellow, "4"=green, "5"=cyan, "6"=purple

**Layout guidelines:**
- x increases right, y increases down
- Position = top-left corner
- 20-50px padding inside groups
- 50-100px between nodes
- Align to multiples of 20

### Command Interface
```bash
clawvault canvas -v <vault-path> [options]
```

Options:
- `--output <path>` — Output path (default: `brain-architecture.canvas` in vault root)
- `--mode architecture|graph|dashboard` — What to generate:
  - `architecture` — High-level vault structure as groups with file nodes for key files
  - `graph` — Memory graph visualization (nodes + edges with force-directed layout)
  - `dashboard` — Summary cards (stats, recent observations, open loops, top entities)
- `--max-nodes <n>` — Limit nodes (default: 100, prune lowest degree first)
- `--filter-type <type>` — Only include nodes of specific type
- `--include-unresolved` — Include unresolved wiki-link phantom nodes (default: exclude)

### Architecture Mode
Creates group nodes for major vault sections:
- **Knowledge Vault** (green/"4") — group containing sub-groups for each category
- **Ledger** (orange/"2") — group with raw/, observations/, reflections/ as text nodes
- **Agent Config** (cyan/"5") — group with file nodes for AGENTS.md, SOUL.md, etc.
- **Data Flow** (purple/"6") — text node showing the observation pipeline

Use `file` type nodes to reference actual vault files (so clicking opens them in Obsidian).

Edges show data flow between components:
- Agent workspace → Ledger (writes transcripts)
- Ledger raw → Ledger observations (LLM observe)
- Observations → Knowledge Vault (auto-route high importance)
- Observations → Reflections (weekly reflect)

### Graph Mode
Force-directed layout algorithm:
1. Initialize nodes at random positions within bounded area
2. Iterate (100 iterations): repulsion between all nodes, attraction along edges
3. Map node types to colors:
   - person="5" (cyan), project="4" (green), decision="2" (orange)
   - lesson="3" (yellow), observation="6" (purple), tag=no color
   - note=no color, unresolved="1" (red)
4. Scale node width/height with degree (min 200x60, max 400x200)
5. Use `file` type nodes for nodes that have a real file path

### Dashboard Mode
Creates text cards showing:
- Stats: total nodes, edges, files, categories
- Recent observations: last 7 days (scored format)
- Open loops: from latest reflection if exists
- Top 10 entities: highest-degree graph nodes
- Category breakdown: file counts per category

### Implementation Files
```
src/commands/canvas.ts        — Command implementation
src/commands/canvas.test.ts   — Tests
src/lib/canvas-layout.ts      — Layout algorithms
src/lib/canvas-layout.test.ts — Layout tests
```

## Component 2: `clawvault mcp` — MCP Server (stdio)

Implements a Model Context Protocol server for integration with any MCP client (Obsidian with MCP plugin, Cursor, Claude Desktop, etc.).

### MCP Protocol
- Transport: stdin/stdout, JSON-RPC 2.0, newline-delimited JSON
- Server reads from stdin, writes to stdout
- Logging to stderr only (never non-JSON to stdout)

### Lifecycle
```
Client → {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test"}}}
Server → {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{},"resources":{}},"serverInfo":{"name":"clawvault","version":"2.3.0"}}}
Client → {"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
```

### Tools (9 tools)

1. **search** — `{ query, limit?, category? }` → `{ results: [{title, path, snippet, score}] }`
2. **vsearch** — `{ query, limit? }` → same (semantic, requires qmd)
3. **store** — `{ category, title, content, frontmatter? }` → `{ path, success }`
4. **read** — `{ path }` → `{ content, frontmatter, title }`
5. **context** — `{ profile?, maxTokens? }` → `{ context, tokenCount }`
6. **graph_stats** — `{}` → `{ nodeCount, edgeCount, nodeTypeCounts, topEntities }`
7. **observe** — `{ content, source? }` → `{ path, success }`
8. **remember** — `{ type, title, content }` → `{ path, success }`
9. **status** — `{}` → `{ name, path, documentCount, categories, graphStats }`

### Resources
1. `vault://status` — Current vault status JSON
2. `vault://graph` — Full memory graph as JSON
3. `vault://observations/latest` — Latest compiled observations

### Implementation Files
```
src/mcp/server.ts        — JSON-RPC server on stdio
src/mcp/server.test.ts   — Protocol tests
src/mcp/handlers.ts      — Tool/resource implementations
src/mcp/handlers.test.ts — Handler tests
src/mcp/types.ts         — MCP protocol types
src/commands/mcp.ts      — CLI command
src/commands/mcp.test.ts
```

### Command Interface
```bash
clawvault mcp -v <vault-path> [--log-level debug|info|warn|error]
```

### Client Configuration Examples

**Cursor `.cursor/mcp.json`:**
```json
{"mcpServers":{"clawvault":{"command":"clawvault","args":["mcp","-v","/path/to/vault"]}}}
```

**Claude Desktop:**
```json
{"mcpServers":{"clawvault":{"command":"clawvault","args":["mcp","-v","/path/to/vault"]}}}
```

## Component 3: Obsidian CLI Integration

The Obsidian CLI (`obsidian` command, available in Obsidian 1.12+) allows reading, writing, and searching notes in a running Obsidian instance. ClawVault should integrate with it.

### New command: `clawvault obsidian`
```bash
clawvault obsidian sync -v <vault>     # Push canvas + key files to Obsidian vault
clawvault obsidian dashboard -v <vault> # Generate + push dashboard canvas
clawvault obsidian search <query>       # Search via Obsidian CLI (uses Obsidian's search)
```

**Sync subcommand:** Generates brain-architecture.canvas and pushes it to the Obsidian vault using `obsidian create` or file write (since the vault is just a folder).

**Dashboard subcommand:** Generates a dashboard canvas and writes it to the vault. If Obsidian CLI is available, opens it with `obsidian open`.

**Detection:** Check if `obsidian` CLI is available via `which obsidian` or trying to run it. If not available, fall back to direct file writes (since Obsidian vaults are just folders).

### Implementation Files
```
src/commands/obsidian.ts      — Obsidian CLI integration
src/commands/obsidian.test.ts — Tests
```

## Build & Ship

After all features are built:
1. Bump version to 2.3.0 in package.json
2. Run `npm run build` — must succeed
3. Run `npm test` — all existing 353+ tests must pass, plus new tests
4. Update CHANGELOG.md with v2.3.0 entry

## Constraints
- **Zero new runtime dependencies** — use Node.js built-in http, crypto, readline, child_process
- TypeScript strict mode, ESM (`"type": "module"`)
- Follow existing patterns in src/commands/ and src/lib/
- Don't modify existing tests or break existing functionality
- Register all new commands in CLI entry point (check bin/ directory for pattern)
- All new commands need --help with usage examples
- Canvas output must be valid JSON Canvas spec (jsoncanvas.org/spec/1.0/)
- MCP must follow JSON-RPC 2.0 spec exactly

## Reference Files
- Memory graph: `src/lib/memory-graph.ts`
- Context profiles: `src/lib/context-profile.ts`
- Search: `src/lib/search.ts`
- Vault operations: `src/lib/vault.ts`
- Config: `src/lib/config.ts`
- Types: `src/types.ts`
- Observe: `src/commands/observe.ts`
- CLI registration: `bin/` directory
- Ledger: `src/lib/ledger.ts`
- Observation format: `src/lib/observation-format.ts`
