# ClawVault OpenClaw v2026.2.9 Compatibility Findings

## Summary

ClawVault v1.8.2 is **fully compatible** with OpenClaw v2026.2.9.

### Implemented (v1.8.1 → v1.8.2)
- ✅ OPENCLAW_HOME env var support
- ✅ OPENCLAW_STATE_DIR env var support
- ✅ Path validation (trim, require absolute paths)
- ✅ Robust error handling in listAgents()

## Analysis

### ✅ Hook Compatibility (VERIFIED)

- ClawVault hook shows "✓ ready" in `openclaw hooks list`
- Hook uses ES modules correctly (`export default handler`)
- The tsdown migration fix (#9295) was on OpenClaw's side, not ours
- No changes needed

### ✅ Post-Compaction Amnesia Fix (BENEFITS AUTOMATICALLY)

- OpenClaw now preserves parentId chain in injected transcripts (#12283)
- Our `session-recap` command reads JSONL files directly
- Better transcript integrity = better session context restoration
- No changes needed

### ⚠️ OPENCLAW_HOME Support (ENHANCEMENT OPPORTUNITY)

**Current behavior:**
- `session-utils.ts` hardcodes `os.homedir() + '.openclaw/agents'`

**Recommended change:**
- Support `OPENCLAW_HOME` environment variable (#12091)
- Also consider `OPENCLAW_STATE_DIR` (#4824)

**Impact:** Users with custom OpenClaw installations can now override paths.

### ✅ Memory/QMD Cache (NO ACTION)

- The QMD cache reuse (#12114) is on OpenClaw's side
- Benefits multi-agent setups automatically
- No changes needed

## Recommended Changes

### 1. Support OPENCLAW_HOME in session-utils.ts

```typescript
// Before
export function getOpenClawAgentsDir(): string {
  return path.join(os.homedir(), '.openclaw', 'agents');
}

// After
export function getOpenClawDir(): string {
  const home = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
  return home;
}

export function getOpenClawAgentsDir(): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR;
  if (stateDir) {
    return path.join(stateDir, 'agents');
  }
  return path.join(getOpenClawDir(), 'agents');
}
```

### 2. Update CHANGELOG.md

Add entry for OPENCLAW_HOME/OPENCLAW_STATE_DIR support.

### 3. Version Bump

v1.8.0 → v1.8.1 (minor feature enhancement)

## Testing

```bash
# Test with default paths
clawvault session-recap agent:clawdious:main

# Test with OPENCLAW_HOME override
OPENCLAW_HOME=/custom/path clawvault session-recap agent:test:main

# Verify hooks fire
openclaw logs --tail 50 | grep clawvault
```

## Conclusion

ClawVault works correctly with OpenClaw v2026.2.9. The OPENCLAW_HOME enhancement is optional but recommended for completeness.
