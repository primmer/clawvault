# ClawVault 🐘

**An elephant never forgets.**

Structured memory system for AI agents with Obsidian-compatible markdown and embedded semantic search.

[![npm version](https://badge.fury.io/js/clawvault.svg)](https://www.npmjs.com/package/clawvault)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why ClawVault?

AI agents forget things. Context windows overflow, sessions end, important details get lost. ClawVault fixes that by providing:

- **Structured storage** — Not random notes, organized knowledge in categories
- **Built-in search** — Fast BM25 search, no external dependencies
- **Semantic search** — Optional [qmd](https://github.com/Versatly/qmd) integration for embeddings
- **Wiki-links** — `[[connections]]` visible in Obsidian's graph view
- **Token efficient** — Search instead of loading entire memory files

## Installation

```bash
npm install -g clawvault
```

Or use it as a library:

```bash
npm install clawvault
```

## CLI Quick Start

### Initialize a vault

```bash
clawvault init ~/my-memory

# With qmd semantic search (optional)
clawvault init ~/my-memory --qmd
```

### Store memories

```bash
# Store a decision
clawvault store -c decisions -t "Use TypeScript" \
  --content "Decided to use TypeScript for type safety and better DX."

# Quick capture to inbox
clawvault capture "Remember to follow up with Pedro about the project"

# Store from file
clawvault store -c people -t "Pedro" -f pedro-notes.txt
```

### Search memories

```bash
# Fast keyword search (BM25)
clawvault search "TypeScript decision"

# Filter by category
clawvault search "Pedro" -c people

# Semantic search (requires qmd)
clawvault vsearch "what did we decide about programming languages"
```

### Other commands

```bash
# List all documents
clawvault list

# List by category
clawvault list decisions

# Get a specific document
clawvault get people/pedro

# Show vault statistics
clawvault stats

# Sync to another location (e.g., for Obsidian on Windows)
clawvault sync /mnt/c/Users/me/Obsidian/memory

# Rebuild search index
clawvault reindex
```

## Library Usage

```typescript
import { ClawVault, createVault, findVault } from 'clawvault';

// Create a new vault
const vault = await createVault('./my-memory');

// Or find nearest existing vault
const vault = await findVault();

// Store a memory
await vault.store({
  category: 'decisions',
  title: 'Use ClawVault',
  content: 'Decided to use ClawVault for persistent memory.',
  frontmatter: { status: 'implemented' }
});

// Quick capture
await vault.capture('Remember to check on this later');

// Search
const results = await vault.find('memory management', {
  limit: 5,
  category: 'decisions'
});

for (const result of results) {
  console.log(`${result.document.title} (${result.score.toFixed(2)})`);
  console.log(result.snippet);
}

// Get stats
const stats = await vault.stats();
console.log(`${stats.documents} documents, ${stats.links} links`);
```

## Vault Structure

ClawVault creates an organized directory structure:

```
my-memory/
├── .clawvault.json      # Vault config
├── .clawvault-index.json # Search index
├── README.md            # Vault readme
├── preferences/         # Likes, dislikes, settings
├── decisions/           # Choices with context
├── patterns/            # Observed behaviors
├── people/              # One file per person
├── projects/            # Active projects
├── goals/               # Short and long-term
├── transcripts/         # Session summaries
├── inbox/               # Quick capture (process later)
└── templates/           # Document templates
```

## Document Format

Documents are markdown with YAML frontmatter:

```markdown
---
title: "Decision: Use ClawVault"
date: 2024-01-15
status: implemented
---

# Decision: Use ClawVault

## Context
Needed persistent memory that survives context window limits.

## Options
1. **Plain files** — Simple but no search
2. **Database** — Overkill for text
3. **ClawVault** — Structured markdown with search

## Decision
Use ClawVault.

## Related
- [[people/pedro]]
- [[projects/ai-assistant]]

#decision #memory
```

## qmd Integration

For semantic search, install [qmd](https://github.com/Versatly/qmd):

```bash
# Install qmd
npm install -g qmd

# Initialize vault with qmd
clawvault init ~/my-memory --qmd

# Or add qmd to existing vault
qmd collection add ~/my-memory --name my-memory --mask "**/*.md"
qmd embed

# Use semantic search
clawvault vsearch "what are my communication preferences"
```

## API Reference

### ClawVault Class

```typescript
class ClawVault {
  // Initialize a new vault
  init(options?: Partial<VaultConfig>): Promise<void>;
  
  // Load existing vault
  load(): Promise<void>;
  
  // Store a document
  store(options: StoreOptions): Promise<Document>;
  
  // Quick capture to inbox
  capture(note: string, title?: string): Promise<Document>;
  
  // Search vault
  find(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  
  // Get document by ID
  get(idOrPath: string): Promise<Document | null>;
  
  // List documents
  list(category?: string): Promise<Document[]>;
  
  // Sync to another location
  sync(options: SyncOptions): Promise<SyncResult>;
  
  // Rebuild search index
  reindex(): Promise<number>;
  
  // Get statistics
  stats(): Promise<VaultStats>;
}
```

### Helper Functions

```typescript
// Create a new vault
createVault(path: string, options?: Partial<VaultConfig>): Promise<ClawVault>;

// Find nearest vault (walks up directory tree)
findVault(startPath?: string): Promise<ClawVault | null>;
```

### Types

```typescript
interface StoreOptions {
  category: string;
  title: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  overwrite?: boolean;
}

interface SearchOptions {
  limit?: number;
  minScore?: number;
  category?: string;
  tags?: string[];
  fullContent?: boolean;
}

interface SearchResult {
  document: Document;
  score: number;  // 0-1
  snippet: string;
  matchedTerms: string[];
}
```

## Best Practices

1. **Link everything** — Use `[[wiki-links]]` to connect documents
2. **Search before loading** — More token efficient than reading entire files
3. **Log decisions immediately** — Don't rely on remembering to remember
4. **Process inbox regularly** — Move quick captures to proper categories
5. **Use templates** — Check `templates/` for document patterns

## License

MIT

---

*"An elephant never forgets." — Now neither do you.* 🐘

## Relationship Tracking

ClawVault now includes templates for tracking relationships:

### Agents (`people/agents/`)
Track other AI agents you interact with:
- Trust levels (observe → engage → collaborate → ally)
- What they build
- What you learned from them
- Interaction history

### Humans (`people/humans/`)
Track humans (including agents' humans):
- How you were introduced
- Their agents
- What they need / what they offer
- Professional context

### Templates
- `templates/AGENT.md` — For tracking AI agents
- `templates/HUMAN.md` — For tracking humans

This structure supports building persistent social memory across sessions.
