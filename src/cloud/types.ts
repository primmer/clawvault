export interface CloudConfig {
  cloudApiKey?: string;
  cloudVaultId?: string;
  cloudOrgSlug?: string;
  cloudApiUrl?: string;
}

export interface DecisionTraceInputSource {
  source: string;
  type: string;
  id: string;
  data?: Record<string, unknown>;
}

export interface DecisionTracePolicy {
  id: string;
  name: string;
  version: string;
  rule: string;
  result: string;
}

export interface DecisionTraceException {
  policyId: string;
  reason: string;
  approvedBy?: string;
}

export interface DecisionTraceOutcome {
  action: string;
  target: string;
  data?: Record<string, unknown>;
  success: boolean;
}

export interface DecisionTraceEntityRef {
  type: string;
  id: string;
  name?: string;
  role?: string;
}

export interface DecisionTrace {
  localTraceId: string;
  timestamp: string;
  summary: string;
  inputs: DecisionTraceInputSource[];
  policies: DecisionTracePolicy[];
  exceptions: DecisionTraceException[];
  outcome: DecisionTraceOutcome;
  entityRefs: DecisionTraceEntityRef[];
}

export interface DecisionTraceInput extends Partial<DecisionTrace> {
  summary: string;
}

export interface QueueFile {
  traces: DecisionTrace[];
  updatedAt: string;
}

export interface CloudSyncResult {
  attempted: number;
  synced: number;
  remaining: number;
  skippedReason?: string;
}

export interface OrgLinkResult {
  vaultId: string;
  orgSlug?: string;
  raw?: unknown;
}
