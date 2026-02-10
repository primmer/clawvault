# Local ClawVault Enhancement Task

You're enhancing the ClawVault CLI to support cloud sync. This is a 24-hour sprint.

## Your Mission
Add cloud integration to existing ClawVault CLI:
1. `clawvault config --cloud-key <key>` - Set API key for cloud
2. `clawvault org link` - Connect vault to org
3. `clawvault org status` - Show cloud connection status
4. `clawvault sync` - Push traces to cloud
5. `clawvault trace emit` - Emit decision trace (local + cloud)
6. Auto-sync on checkpoint/handoff

## Current ClawVault
- npm package: clawvault
- GitHub: https://github.com/Versatly/clawvault
- Already has: store, search, vsearch, checkpoint, handoff, recover, capture, remember

## Cloud API
Base URL: http://localhost:4000 (dev) or https://api.clawvault.io (prod)

### Register Vault
POST /vaults/register
Headers: X-API-Key: <key>
Body: { name: "vault-name", agentId: "agent-123" }

### Sync Traces
POST /vaults/:vaultId/sync
Headers: X-API-Key: <key>
Body: { traces: DecisionTrace[] }

## Implementation

### Config Storage
Add to ~/.clawvault/config.json:
{
  "cloudApiKey": "cvk_...",
  "cloudVaultId": "vault-123",
  "cloudOrgSlug": "my-org"
}

### Decision Trace Format
{
  "localTraceId": "trace-uuid",
  "timestamp": "2026-02-10T01:30:00Z",
  "summary": "Approved 20% discount for ACME Corp",
  "inputs": [
    { "source": "salesforce", "type": "opportunity", "id": "opp-123", "data": {...} }
  ],
  "policies": [
    { "id": "pol-1", "name": "Discount Limit", "version": "1.0", "rule": "max 10%", "result": "exception" }
  ],
  "exceptions": [
    { "policyId": "pol-1", "reason": "Customer had 3 SEV-1s", "approvedBy": "vp-sales" }
  ],
  "outcome": {
    "action": "apply_discount",
    "target": "opportunity",
    "data": { "discount": 0.20 },
    "success": true
  },
  "entityRefs": [
    { "type": "account", "id": "acme-123", "name": "ACME Corp", "role": "subject" }
  ]
}

### Offline Queue
Store pending traces in ~/.clawvault/sync-queue.json
Sync when connection available

### Auto-Sync Hooks
- On checkpoint: if cloud configured, sync recent traces
- On handoff: sync all pending traces

## Files to Modify
- src/commands/ - Add new commands
- src/cloud/ - New cloud client module
- src/config.ts - Add cloud config fields

## When Done
Run: openclaw system event --text "Local ClawVault enhanced: cloud config, org link, sync, trace emit, auto-sync all working" --mode now
