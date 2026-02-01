# Task: Implement Auto-Linking for ClawVault

## Context
ClawVault is a CLI tool at /home/frame/clawd/clawvault/
It's a TypeScript/Node project using Commander.js
Memory vault is at /home/frame/clawd/memory/

## Goal
Add auto-linking capability to ClawVault that:
1. Uses the vault itself as the entity registry (no separate config)
2. Extracts linkable entities from file paths + frontmatter aliases
3. Auto-links mentions in markdown files

## Design Principles
- **The vault IS the registry** — scan files to build entity index
- **Frontmatter-driven** — `aliases` field in YAML frontmatter provides alternate names
- **Path-derived** — `people/pedro.md` means "pedro" is linkable
- **Longest-match-first** — "Justin Dukes" before "Justin"
- **Smart boundaries** — only link at word boundaries, skip code blocks

## Current ClawVault Structure
```
src/
  index.ts          # Main entry, Commander setup
  commands/         # Command implementations
  lib/              # Shared utilities
```

## Implementation

### 1. Entity Index Builder
Create `src/lib/entity-index.ts`:
- Scan all .md files in vault (CLAWVAULT_PATH env var)
- Extract from each file:
  - Primary name: filename without .md
  - Path: relative path without .md (e.g., `people/pedro`)
  - Aliases: from frontmatter `aliases` array
  - Title: from frontmatter `title` field
- Build map: `{alias -> path}` for all names
- Return sorted by alias length (longest first)

### 2. Auto-Linker Logic
Create `src/lib/auto-linker.ts`:
- Takes markdown content + entity index
- For each paragraph (skip code blocks, frontmatter, existing links):
  - Find all entity mentions (longest-match-first, word-boundary)
  - Replace first occurrence with `[[path]]` or `[[path|original-text]]`
- Return modified content

### 3. Link Command
Create `src/commands/link.ts`:
```bash
clawvault link <file>           # Link single file
clawvault link --all            # Link all files in vault
clawvault link --dry-run        # Show what would be linked
```

### 4. Entities Command
Create `src/commands/entities.ts`:
```bash
clawvault entities              # List all linkable entities
clawvault entities --json       # JSON output
```

## Edge Cases to Handle
- Don't link inside `[[existing links]]`
- Don't link inside code blocks (``` or inline `)
- Don't link inside frontmatter (--- block)
- Don't link URLs
- Case-insensitive matching, preserve original case in output
- Only link first occurrence per entity per file

## Test
After implementation:
```bash
cd /home/frame/clawd/clawvault
npm run build
CLAWVAULT_PATH=/home/frame/clawd/memory clawvault entities
CLAWVAULT_PATH=/home/frame/clawd/memory clawvault link --dry-run /home/frame/clawd/memory/2026-01-31.md
```

## Reference
Look at existing commands in src/commands/ for patterns.
Use gray-matter for frontmatter parsing (already a dependency).
