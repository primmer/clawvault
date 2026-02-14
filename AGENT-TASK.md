# ClawVault: Canvas Export + MCP Server

Build two new features for ClawVault: (1) Obsidian Canvas export from the memory graph, and (2) a stdio MCP server for external tool integration.

## Component 1: `clawvault canvas` command

Generates an Obsidian Canvas file (`.canvas` JSON format) from the vault's memory graph.

### Obsidian Canvas Format
The `.canvas` file is JSON with this structure:
```json
{
  "nodes": [
    {
      "id": "unique-id",
      "type": "text",  // or "file", "link", "group"
      "x": 0,
      "y": 0,
      "width": 250,
      "height": 60,
      "text": "Content here",  // for type=text
      "file": "path/to/file.md",  // for type=file
      "color": "1"  // 1-6 for preset colors, or hex "#ff0000"
    }
  ],
  "edges": [
    {
      "id": "edge-id",
      "fromNode": "node-id-1",
      "fromSide": "bottom",
      "toNode": "node-id-2",
      "toSide": "top",
      "color": "1",
      "label": "optional label"
    }
  ]
}
```

Canvas colors: 1=red, 2=orange, 3=yellow, 4=green, 5=cyan, 6=purple. Or hex strings.

### Command Interface
```bash
clawvault canvas -v <vault-path> [options]
```

Options:
- `--output <path>` — Output .canvas file path (default: `<vault>/brain-architecture.canvas`)
- `--mode architecture|graph|dashboard` — What to generate:
  - `architecture` — High-level vault structure (groups for categories, key files as nodes)
  - `graph` — Full memory graph (all nodes + edges from `clawvault graph`)
  - `dashboard` — Summary dashboard (stats, recent observations, open loops, key entities)
- `--max-nodes <n>` — Limit nodes for large graphs (default: 100, prune by degree)
- `--filter-type <type>` — Only include nodes of this type (decision, person, project, etc.)
- `--include-unresolved` — Include unresolved wiki-link nodes (default: exclude)
- `--layout force|grid|radial` — Layout algorithm:
  - `force` — Force-directed (default, best for graphs)
  - `grid` — Grid layout by category
  - `radial` — Radial from highest-degree node

### Architecture Mode Layout
Creates groups (Obsidian Canvas groups) for each major vault section:
- **Knowledge Vault** (green group) — categories as sub-groups, key files as file nodes
- **Ledger** (orange group) — raw/, observations/, reflections/ structure
- **Agent Config** (cyan group) — AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, etc.
- **Memory Graph** (purple group) — stats node showing node/edge counts, top entities

Connect groups with edges showing data flow:
- Agent → writes → Ledger/raw
- Ledger/raw → observe → Ledger/observations
- Observations → reflect → Ledger/reflections
- Observations → route → Knowledge Vault categories

### Graph Mode Layout
Implements a simple force-directed layout algorithm:
1. Initialize nodes at random positions
2. Iterate: repulsion between all nodes, attraction along edges
3. Apply Barnes-Hut optimization for O(n log n)
4. Output final positions

Each node type gets a different color:
- person: cyan (#00b4d8)
- project: green (#2d6a4f)
- decision: orange (#e8590c)
- lesson: yellow (#fcc419)
- observation: purple (#7950f2)
- tag: gray (#868e96)
- note: default
- unresolved: red (#e03131)

Node size (width/height) scales with degree (more connections = bigger).

### Dashboard Mode
Creates a canvas with:
- Stats card (total nodes, edges, files, observations)
- Recent observations card (last 7 days, scored format)
- Open loops card (from latest reflection)
- Top entities card (highest-degree nodes)
- Category breakdown card
- Data flow diagram (same as architecture mode)

### Implementation
```
src/commands/canvas.ts       — Command implementation
src/commands/canvas.test.ts  — Tests
src/lib/canvas-layout.ts     — Layout algorithms (force-directed, grid, radial)
src/lib/canvas-layout.test.ts — Layout tests
```

Use the existing `buildOrUpdateMemoryGraphIndex()` from `src/lib/memory-graph.ts` to get graph data. The canvas command reads the graph and transforms it into the Obsidian Canvas JSON format.

## Component 2: `clawvault mcp` — MCP Server (stdio)

Implements a Model Context Protocol server over stdio for integration with MCP clients (Obsidian, Cursor, Claude Desktop, etc.).

### MCP Protocol (stdio)
- Transport: stdin/stdout, JSON-RPC 2.0
- One message per line (newline-delimited JSON)
- Server reads requests from stdin, writes responses to stdout
- stderr for logging (never write non-JSON to stdout)

### MCP Methods to Implement

**Tools (callable by client):**

1. `search` — Search vault
   - Params: `{ query: string, limit?: number, category?: string }`
   - Returns: `{ results: [{ title, path, snippet, score }] }`

2. `vsearch` — Semantic search (if qmd available)
   - Params: `{ query: string, limit?: number }`
   - Returns: same as search

3. `store` — Store a document
   - Params: `{ category: string, title: string, content: string, frontmatter?: object }`
   - Returns: `{ path: string, success: boolean }`

4. `read` — Read a document
   - Params: `{ path: string }` (relative to vault)
   - Returns: `{ content: string, frontmatter: object, title: string }`

5. `context` — Get context injection (like `clawvault context`)
   - Params: `{ profile?: string, maxTokens?: number }`
   - Returns: `{ context: string, tokenCount: number }`

6. `graph_stats` — Get memory graph statistics
   - Params: `{}`
   - Returns: `{ nodeCount, edgeCount, nodeTypeCounts, topEntities: [{id, degree}] }`

7. `observe` — Submit an observation
   - Params: `{ content: string, source?: string }`
   - Returns: `{ path: string, success: boolean }`

8. `remember` — Quick memory capture (like `clawvault remember`)
   - Params: `{ type: string, title: string, content: string }`
   - Returns: `{ path: string, success: boolean }`

9. `status` — Vault status
   - Params: `{}`
   - Returns: `{ name, path, documentCount, categories, graphStats }`

**Resources (readable by client):**

1. `vault://status` — Current vault status
2. `vault://graph` — Full graph as JSON
3. `vault://observations/latest` — Latest observations

### MCP JSON-RPC Format
```json
// Request
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test"}}}

// Response
{"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}, "resources": {}}, "serverInfo": {"name": "clawvault", "version": "2.2.0"}}}

// Tool call
{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "search", "arguments": {"query": "decisions about auth"}}}

// Tool list
{"jsonrpc": "2.0", "id": 3, "method": "tools/list", "params": {}}

// Resource read
{"jsonrpc": "2.0", "id": 4, "method": "resources/read", "params": {"uri": "vault://status"}}
```

### Implementation
```
src/mcp/server.ts       — MCP server (stdin/stdout JSON-RPC)
src/mcp/server.test.ts  — Server tests
src/mcp/handlers.ts     — Tool/resource handlers
src/mcp/handlers.test.ts — Handler tests  
src/mcp/types.ts        — MCP protocol types
src/commands/mcp.ts     — `clawvault mcp` CLI command
src/commands/mcp.test.ts
```

### Command Interface
```bash
clawvault mcp -v <vault-path> [--log-level debug|info|warn|error]
```

Starts the MCP server on stdio. Logs go to stderr.

### MCP Client Configuration Examples

**Cursor (`.cursor/mcp.json`):**
```json
{
  "mcpServers": {
    "clawvault": {
      "command": "clawvault",
      "args": ["mcp", "-v", "/path/to/vault"]
    }
  }
}
```

**Claude Desktop (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "clawvault": {
      "command": "clawvault",
      "args": ["mcp", "-v", "/path/to/vault"]
    }
  }
}
```

## Constraints
- Zero new runtime dependencies (use Node.js built-in readline for stdio)
- TypeScript strict mode, ESM
- Follow existing patterns in src/commands/ and src/lib/
- Don't modify existing tests or break existing functionality
- Must pass all existing tests + new ones
- `npm run build` must succeed
- Register both commands in the CLI entry point (check bin/ for registration pattern)

## Testing
- Canvas: test all 3 modes, verify valid JSON output, verify Obsidian canvas schema
- MCP: test JSON-RPC protocol, tool calls, resource reads, error handling
- MCP: test with mock stdin/stdout streams
- `npm test` and `npm run build` must pass

## Reference Files
- Memory graph: `src/lib/memory-graph.ts` (buildOrUpdateMemoryGraphIndex, MemoryGraph types)
- Context: `src/commands/context.ts` (context injection logic)
- Search: `src/lib/search.ts`
- Observe: `src/commands/observe.ts`
- Store: existing store logic in `src/lib/vault.ts`
- CLI registration: `bin/` directory
- Types: `src/types.ts`
