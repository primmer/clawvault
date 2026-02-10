interface DecisionTraceInputSource {
    source: string;
    type: string;
    id: string;
    data?: Record<string, unknown>;
}
interface DecisionTracePolicy {
    id: string;
    name: string;
    version: string;
    rule: string;
    result: string;
}
interface DecisionTraceException {
    policyId: string;
    reason: string;
    approvedBy?: string;
}
interface DecisionTraceOutcome {
    action: string;
    target: string;
    data?: Record<string, unknown>;
    success: boolean;
}
interface DecisionTraceEntityRef {
    type: string;
    id: string;
    name?: string;
    role?: string;
}
interface DecisionTrace {
    localTraceId: string;
    timestamp: string;
    summary: string;
    inputs: DecisionTraceInputSource[];
    policies: DecisionTracePolicy[];
    exceptions: DecisionTraceException[];
    outcome: DecisionTraceOutcome;
    entityRefs: DecisionTraceEntityRef[];
}
interface DecisionTraceInput extends Partial<DecisionTrace> {
    summary: string;
}
interface CloudSyncResult {
    attempted: number;
    synced: number;
    remaining: number;
    skippedReason?: string;
}

export type { CloudSyncResult as C, DecisionTraceInput as D, DecisionTrace as a };
