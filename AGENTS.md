# AGENTS.md

## Overview

ClawVault is a structured memory system for AI agents. It stores knowledge as typed markdown files with YAML frontmatter. Ships as both a CLI tool (`clawvault`) and an OpenClaw plugin.

**Language:** TypeScript (Node.js 18+)
**Package manager:** npm (with workspaces)
**Build tool:** tsup (ESM + CJS + type declarations)
**Test framework:** Vitest

## Setup from Fresh Clone

```bash
npm install
npm run build
```

## Development

```bash
npm run dev       # watch mode (tsup --watch)
npm run build     # production build
npm run lint      # eslint src/
npm run typecheck # tsc --noEmit
npm run test      # vitest run
npm run ci        # typecheck + build + test
```

## Project Structure

```
src/
  cli/            # CLI entry point (commander-based)
  commands/       # One file per CLI command + co-located tests
  lib/            # Shared utilities (config, search, templates, etc.)
  observer/       # Session observation pipeline (watcher, compressor, router)
  plugin/         # OpenClaw plugin (auto-recall, auto-capture, tools)
  replay/         # Conversation replay/import
  test/           # Vitest setup and global config
  types.ts        # Shared type definitions
  index.ts        # Library entry point
packages/
  obsidian/       # Obsidian plugin (private, minimal)
  sdk/            # TypeScript SDK
shared/           # JS constants shared between build targets
schemas/          # JSON Schema definitions for compat validation
templates/        # Default primitive templates (task, decision, lesson, etc.)
bin/              # CLI bin stubs
docs/             # User-facing documentation
```

## Environment Variables

All optional. ClawVault works without any env vars for basic CLI usage.

| Variable                      | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `CLAWVAULT_PATH`              | Vault directory path (overrides auto-discovery from cwd) |
| `CLAWVAULT_NO_LLM`            | Set to `1` to disable all LLM calls (observer, wake)     |
| `CLAWVAULT_CLAUDE_AUTH`       | Set to `1` to enable Claude keychain auth (opt-in)       |
| `ANTHROPIC_API_KEY`           | Anthropic API key for LLM compression                    |
| `OPENAI_API_KEY`              | OpenAI API key (alternative LLM backend)                 |
| `GEMINI_API_KEY`              | Google Gemini API key (alternative LLM backend)          |
| `ANTHROPIC_OAUTH_TOKEN`       | Anthropic OAuth token (alternative to API key)           |
| `OPENCLAW_AGENT_ID`           | Agent identifier for session tracking                    |
| `OPENCLAW_STATE_DIR`          | OpenClaw state directory override                        |
| `OPENCLAW_SESSION_FILE`       | Session transcript file path                             |
| `OPENCLAW_SESSION_TRANSCRIPT` | Alternative session transcript path                      |
| `OPENCLAW_SESSION_KEY`        | Session key for checkpoint/sleep                         |
| `OPENCLAW_MODEL`              | Model name for checkpoint metadata                       |
| `OPENCLAW_TOKEN_ESTIMATE`     | Token estimate for transition ledger                     |
| `OPENCLAW_CONTEXT_TOKENS`     | Context token count (fallback for token estimate)        |

## Testing

Tests are co-located with source files (`*.test.ts`). Run:

```bash
npm test              # all tests
npx vitest run <file> # single file
npx vitest --watch    # watch mode
```

Tests use a dedicated qmd index (`clawvault-test`) configured in `src/test/vitest.setup.ts`. No external services required.

## Conventions

- **Naming:** camelCase for functions/variables, PascalCase for types/interfaces, kebab-case for file names
- **Imports:** Node.js built-ins use `node:` prefix. Relative imports use `.js` extension (NodeNext resolution)
- **Tests:** Co-located with source as `<filename>.test.ts`
- **Commands:** One file per CLI command in `src/commands/`, exported as a function
- **Templates:** Primitive schemas live in `templates/*.md` with YAML frontmatter defining fields, types, defaults, and enums
- **No console.log in library code:** CLI output uses `chalk` for colored terminal output
