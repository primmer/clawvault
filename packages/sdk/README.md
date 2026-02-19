# @clawvault/sdk

Programmatic TypeScript SDK for [ClawVault](https://clawvault.dev) — structured memory for AI agents. 🐘

## Installation

```bash
npm install @clawvault/sdk
```

## Quick Start

```typescript
import { createVault } from '@clawvault/sdk';

const vault = createVault('/path/to/your/vault');

// Search memories
const results = await vault.search('project deadlines');

// Store an observation
await vault.observe('User prefers dark mode interfaces', {
  tags: ['preference', 'ui'],
});

// Build context for an LLM prompt
const ctx = await vault.context({ profile: 'compact' });

// Knowledge graph
const entities = await vault.graph.entities();
const edges = await vault.graph.relationships();
const matched = await vault.graph.query('clawvault');

// Preferences
const prefs = await vault.preferences.get();
const extracted = vault.preferences.extract('I always use vim keybindings');
```

## API

### `createVault(path: string): Vault`

Factory function that returns a `Vault` instance.

### `Vault`

| Method | Description |
|---|---|
| `search(query, opts?)` | BM25 + vector search over vault documents |
| `observe(content, opts?)` | Store an observation into the vault |
| `context(opts?)` | Build a context bundle for LLM consumption |
| `checkpoint()` | Create a snapshot (not yet implemented) |
| `restore(id)` | Restore to a checkpoint (not yet implemented) |

### `Vault.graph`

| Method | Description |
|---|---|
| `entities()` | List all knowledge graph nodes |
| `relationships()` | List all knowledge graph edges |
| `query(pattern)` | Filter entities by regex pattern |

### `Vault.preferences`

| Method | Description |
|---|---|
| `get()` | Retrieve stored preferences from the vault |
| `extract(text)` | Extract preferences from arbitrary text |

## License

MIT
