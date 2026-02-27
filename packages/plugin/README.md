# @clawvault/memory-plugin

OpenClaw memory plugin package for ClawVault.

This package ships the ClawVault hook handler used for:

- startup context-death detection
- automatic checkpointing on session resets
- heartbeat-based observe triggers
- weekly reflection scheduling
- session-start memory recap injection

## Install

```bash
npm install @clawvault/memory-plugin
```

## Build package artifacts

```bash
npm run build
```

The build step emits `dist/handler.js` and `dist/index.js` and syncs
`openclaw.plugin.json` for package publishing.

## Test

```bash
npm test
```
