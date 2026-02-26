# ClawVault Obsidian Control Plane Plugin

This plugin provides a live operations surface for ClawVault Workgraph v3:

- **Graph Panel** — typed graph summary and top node types
- **Workstreams Board** — workspace/project/task/run/trigger health lanes
- **Ops Rail** — most recent canonical event activity
- **Setup Wizard** — guided configuration for snapshot path + refresh cadence

## Expected Vault Data

The plugin reads:

- `.clawvault/control-plane/snapshot.json` (default)

Generate/update snapshot with:

```bash
clawvault control-plane snapshot -v /path/to/vault
```

For live use, run snapshot generation on a schedule or event trigger.

## Manual install

1. Copy plugin directory contents into your Obsidian vault:
   `.obsidian/plugins/clawvault-control-plane/`
2. Build/compile `main.ts` to `main.js` using your Obsidian plugin toolchain.
3. Enable **ClawVault Control Plane** in Obsidian Community Plugins.

## Commands

- `Open control plane views`
- `Refresh control plane views`
- `Run ClawVault setup wizard`
