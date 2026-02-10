# ClawVault: OpenClaw v2026.2.9 Compatibility Review

## Task

Review ClawVault for compatibility and improvement opportunities based on OpenClaw v2026.2.9 release.

## Key Changelog Items (v2026.2.9)

### CRITICAL — Affects ClawVault

1. **Hooks Fix [#9295]** — Bundled hooks broken since v2026.2.2 (tsdown migration), now fixed
   - Verify our hook in `hooks/clawvault/handler.js` works correctly
   - Check for any tsdown/ESM compatibility issues

2. **Post-Compaction Amnesia Fix [#12283]** — Injected transcript writes now preserve Pi session parentId chain
   - Our `session-recap` command retrieves transcripts
   - Our hook injects context via `injectSystemMessage()`
   - Check if we can improve transcript retrieval now

3. **Memory: Voyage Embeddings [#10818]** — Set input_type for improved retrieval
   - Check if our semantic search (vsearch) can leverage this

4. **Memory/QMD Cache [#12114]** — Reuse default model cache across agents
   - Our qmd integration may benefit from this

### NEW FEATURES to Consider

1. **session:start event** — We already use this, verify it works with improved payload
2. **OPENCLAW_HOME env var [#12091]** — New path override, check if we should support it
3. **Context overflow recovery [#11579]** — Pre-emptive capping + fallback truncation
   - May reduce need for repair-session command

## Files to Review

- `hooks/clawvault/handler.js` — Main hook handler
- `hooks/clawvault/HOOK.md` — Hook documentation
- `src/commands/session-recap.ts` — Session transcript retrieval
- `src/commands/context.ts` — Context injection command
- `src/lib/session-repair.ts` — Session repair logic
- `src/commands/repair-session.ts` — CLI for session repair

## Expected Deliverables

1. **Verify hook compatibility** — Run any necessary tests
2. **Document any changes needed** — If hooks need updates
3. **Consider improvements:**
   - Can session-recap leverage the parentId chain fix?
   - Should we support OPENCLAW_HOME?
   - Can we improve context injection?
4. **Update CHANGELOG.md** if changes made
5. **Bump version in package.json** if changes warrant a release

## How to Test

```bash
# Build
npm run build

# Test hooks (in OpenClaw workspace)
cd ~/.openclaw/workspace
clawvault wake
clawvault checkpoint --working-on "test" --focus "testing"
clawvault sleep "test session" --next "verify" --blocked "none"

# Verify hook events fire (check gateway logs)
openclaw logs --tail 50 | grep clawvault
```

## Reference

- OpenClaw release: https://github.com/openclaw/openclaw/releases/tag/v2026.2.9
- Knowledge base: ~/.openclaw/workspace/memory/openclaw-updates.md
