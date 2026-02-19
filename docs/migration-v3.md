# Migrating from v2.x to v3.x

## What Changed

ClawVault v3 is a significant rewrite:

1. **Single package** — `clawvault` on npm includes CLI, plugin, and templates. No separate `@versatly/*` packages.
2. **Plugin model** — replaces the old hooks-based integration. Uses `openclaw.extensions` instead of `openclaw.hooks`.
3. **Template-driven** — primitive schemas are defined in `templates/` as YAML, not hardcoded in source.
4. **Setup engine** — `clawvault setup` bootstraps Obsidian views and validates vault structure.

## Migration Steps

### 1. Uninstall Old Version

```bash
# Remove old hooks
openclaw hooks disable clawvault
openclaw hooks uninstall clawvault

# Remove old global install
npm uninstall -g clawvault
```

### 2. Install v3

```bash
# Install as OpenClaw plugin
openclaw plugins install clawvault

# Or install CLI globally
npm install -g clawvault
```

### 3. Configure

```bash
# Set vault path
openclaw config set plugins.clawvault.config.vaultPath ~/my-vault
```

### 4. Clean Up Old Config

If you had hooks-based config, remove it:

```bash
# Remove old hooks entries (if present)
openclaw config set hooks.internal.entries.clawvault.enabled false
```

### 5. Restart

```bash
openclaw gateway restart
```

### 6. Verify

```bash
# Check plugin loaded
openclaw status

# Check vault health
clawvault doctor

# Check compatibility
clawvault compat
```

## Breaking Changes

### Hooks → Plugin

| v2.x (hooks) | v3.x (plugin) |
|---------------|---------------|
| `openclaw.hooks` in package.json | `openclaw.extensions` in package.json |
| `hooks/clawvault/handler.js` | `dist/plugin/index.js` |
| `openclaw hooks install` | `openclaw plugins install` |
| `HOOK.md` manifest | `openclaw.plugin.json` manifest |

### Removed Commands

The following commands were removed in v3:

- `canvas` — Obsidian canvas generation (replaced by `setup`)
- `sync-bd` — legacy sync command

### Config Changes

Plugin configuration moved from `hooks.internal.entries.clawvault.config` to `plugins.clawvault.config`.

## Vault Data

Your vault data (markdown files) is fully compatible. No migration needed for existing documents.

Templates in `templates/` are additive — v3 ships with more templates than v2, but your custom templates are preserved and take priority.
