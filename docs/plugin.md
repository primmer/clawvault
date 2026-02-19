# OpenClaw Plugin

ClawVault integrates with [OpenClaw](https://openclaw.ai) as a memory plugin, replacing the built-in memory system with structured, searchable vault storage.

## Installation

```bash
openclaw plugins install clawvault
```

## Configuration

Set your vault path:

```bash
openclaw config set plugins.clawvault.config.vaultPath ~/my-vault
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `vaultPath` | string | — | Path to your ClawVault vault directory (required) |
| `collection` | string | `clawvault` | Name of the qmd search collection |
| `autoRecall` | boolean | `true` | Inject relevant memories before each agent turn |
| `autoCapture` | boolean | `true` | Automatically capture important info from conversations |
| `recallLimit` | number | `5` | Maximum memories to inject per turn (1-20) |

### Example Config

```bash
# Set vault path
openclaw config set plugins.clawvault.config.vaultPath ~/my-vault

# Increase recall limit for more context
openclaw config set plugins.clawvault.config.recallLimit 10

# Disable auto-capture (manual memory only)
openclaw config set plugins.clawvault.config.autoCapture false
```

## Lifecycle Hooks

The plugin registers four hooks into the OpenClaw agent lifecycle:

### `before_agent_start` — Auto-Recall

Before each agent turn, ClawVault searches the vault for memories relevant to the current conversation. It injects up to `recallLimit` memories as context, ranked by relevance.

The search uses qmd's hybrid approach: BM25 keyword matching + vector similarity + reranking. This runs entirely locally — no API keys needed.

### `message_received` — Auto-Capture (inbound)

When a message arrives, the plugin analyzes it for durable information worth storing: facts, preferences, decisions, lessons, relationships. If found, it creates typed vault documents automatically.

### `agent_end` — Auto-Capture (outbound)

After the agent responds, the plugin similarly captures any decisions made, commitments given, or information generated during the turn.

### `before_compaction` — Context Preservation

Before OpenClaw compacts a long conversation, the plugin captures any important context that might be lost in the summary.

## Tools

The plugin provides four tools to the agent:

### `memory_search`

Search the vault using natural language queries. Returns relevant memories ranked by hybrid BM25 + vector similarity.

### `memory_store`

Store a new memory document. Accepts text and optional category (preference, fact, decision, entity, event, other). The plugin classifies and writes a typed markdown document to the vault.

### `memory_get`

Retrieve vault status or stored preferences. Actions: `status` (vault health, document counts) or `preferences` (all stored preferences).

### `memory_forget`

Delete a specific memory. Searches for the memory by query, confirms the match, then removes the file.

## Replacing Built-in Memory

ClawVault replaces OpenClaw's default memory providers (`memory-core` and `memory-lancedb`). When ClawVault is installed as the memory slot plugin, the built-in providers are automatically disabled.

### Advantages over memory-lancedb

- **Fully local** — no OpenAI API key needed for embeddings
- **Typed primitives** — memories have structure (task, decision, lesson) not just text blobs
- **Human-readable** — every memory is a markdown file browsable in Obsidian
- **Malleable schemas** — customize what gets stored by editing templates
- **Hybrid search** — BM25 + vector + reranking via qmd

## Verifying Installation

```bash
# Check plugin is loaded
openclaw status

# Check compatibility
clawvault compat

# Check vault health
clawvault doctor
```
