# ClawVault OpenClaw Plugin

Memory slot provider for OpenClaw with advanced search capabilities and harness-agnostic interface.

## Features

- **OpenClaw Plugin**: Registers as a `memory` kind plugin with native tools
- **Harness-Agnostic MemoryProvider**: Works with LangGraph, CrewAI, AutoGen, or any framework
- **Smart Query Routing**: Auto-detects question types (factual, preference, temporal, semantic)
- **Chunk-level BM25 Pre-filtering**: Efficient candidate selection before ranking
- **Exhaustive Threshold-based Retrieval**: Returns all results above score threshold
- **Preference Extraction**: Automatically extracts user preferences at ingest time
- **Temporal Date Indexing**: Indexes dates and events for temporal queries
- **Background Observer**: Monitors messages via `message_received` hooks

## Installation

```bash
npm install @clawvault/openclaw-plugin
```

## OpenClaw Plugin Usage

Add to your OpenClaw configuration:

```json
{
  "plugins": {
    "slots": {
      "memory": "clawvault"
    },
    "clawvault": {
      "vaultPath": "~/.clawvault",
      "observer": {
        "enabled": true,
        "tokenThreshold": 2000
      },
      "search": {
        "defaultLimit": 10,
        "bm25PrefilterK": 50,
        "exhaustiveThreshold": 0.3
      }
    }
  }
}
```

### Registered Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Search memory with smart query routing |
| `vault_status` | Get vault status and statistics |
| `vault_preferences` | Retrieve extracted user preferences |

### Slash Command

```
/vault status      - Show vault status
/vault search <q>  - Search memory
/vault preferences - Show extracted preferences
/vault dates       - Show indexed dates
/vault flush [id]  - Flush message buffer
/vault help        - Show help
```

## Standalone MemoryProvider Usage

Use the provider directly in any framework:

```typescript
import { createMemoryProvider } from '@clawvault/openclaw-plugin/provider';

const provider = createMemoryProvider({
  vaultPath: '~/.clawvault',
  bm25PrefilterK: 50,
  exhaustiveThreshold: 0.3,
  defaultLimit: 10,
});

// Ingest messages
await provider.ingest('session-123', [
  { role: 'user', content: 'I love TypeScript programming.' },
  { role: 'assistant', content: 'TypeScript is great for type safety!' },
]);

// Search with auto query type detection
const results = await provider.search('What programming languages do I like?');

// Get extracted preferences
const preferences = await provider.getPreferences();

// Get indexed dates
const dates = await provider.getDates();

// Get vault status
const status = await provider.getStatus();
```

### MemoryProvider Interface

```typescript
interface MemoryProvider {
  ingest(sessionId: string, messages: Message[], date?: Date): Promise<IngestResult>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  getPreferences(): Promise<Preference[]>;
  getDates(): Promise<DateIndex[]>;
  getStatus(): Promise<VaultStatus>;
}
```

### Search Options

```typescript
interface SearchOptions {
  limit?: number;           // Max results (default: 10)
  category?: string;        // Filter by category
  dateRange?: {             // Filter by date range
    start?: Date;
    end?: Date;
  };
  threshold?: number;       // Min score threshold (0-1)
  queryType?: QueryType;    // Force query type or 'auto'
}

type QueryType = 'factual' | 'preference' | 'temporal' | 'semantic' | 'auto';
```

## Query Type Detection

The plugin automatically classifies queries:

| Type | Example Queries |
|------|-----------------|
| `preference` | "Do I like coffee?", "What's my favorite food?" |
| `temporal` | "When is my meeting?", "What happened yesterday?" |
| `factual` | "What is TypeScript?", "How does React work?" |
| `semantic` | General queries that don't match other patterns |

## LangGraph Integration

```typescript
import { createMemoryProvider } from '@clawvault/openclaw-plugin/provider';
import { StateGraph } from '@langchain/langgraph';

const provider = createMemoryProvider({ vaultPath: '~/.clawvault' });

const graph = new StateGraph({ channels: { messages: [] } })
  .addNode('ingest', async (state) => {
    await provider.ingest('session', state.messages);
    return state;
  })
  .addNode('search', async (state) => {
    const results = await provider.search(state.query);
    return { ...state, results };
  });
```

## CrewAI Integration

```typescript
import { createMemoryProvider } from '@clawvault/openclaw-plugin/provider';

const provider = createMemoryProvider({ vaultPath: '~/.clawvault' });

const memoryTool = {
  name: 'search_memory',
  description: 'Search agent memory',
  func: async (query: string) => {
    const results = await provider.search(query);
    return JSON.stringify(results);
  },
};
```

## AutoGen Integration

```typescript
import { createMemoryProvider } from '@clawvault/openclaw-plugin/provider';

const provider = createMemoryProvider({ vaultPath: '~/.clawvault' });

const memoryFunction = {
  name: 'search_memory',
  description: 'Search the memory vault',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
    },
    required: ['query'],
  },
  function: async ({ query }) => provider.search(query),
};
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

## Requirements

- Node.js >= 18.0.0
- [qmd](https://github.com/tobi/qmd) for BM25 search (install: `bun install -g github:tobi/qmd`)

## License

MIT
