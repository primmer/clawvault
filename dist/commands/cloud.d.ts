import { C as CloudSyncResult, D as DecisionTraceInput, a as DecisionTrace } from '../types-CilEQY9w.js';

interface CloudStatus {
    configured: boolean;
    cloudApiKeyMasked: string;
    cloudVaultId?: string;
    cloudOrgSlug?: string;
    cloudApiUrl?: string;
    queueDepth: number;
}
interface EmitTraceResult {
    trace: DecisionTrace;
    queueDepth: number;
    sync: CloudSyncResult;
}
declare function getCloudStatus(): CloudStatus;
declare function syncQueuedTraces(options?: {
    all?: boolean;
    limit?: number;
}): Promise<CloudSyncResult>;
declare function emitTrace(input: DecisionTraceInput, syncNow?: boolean): Promise<EmitTraceResult>;
declare function autoSyncOnCheckpoint(): Promise<CloudSyncResult>;
declare function autoSyncOnHandoff(): Promise<CloudSyncResult>;

interface OrgLinkOptions {
    vaultPath: string;
    agentId?: string;
    orgSlug?: string;
}
interface TraceEmitOptions {
    summary?: string;
    traceFile?: string;
    traceJson?: string;
    stdin?: boolean;
    sync?: boolean;
    trace?: DecisionTraceInput;
}
declare function cloudConfigCommand(options: {
    cloudKey?: string;
    cloudApiUrl?: string;
}): Promise<ReturnType<typeof getCloudStatus>>;
declare function orgLinkCommand(options: OrgLinkOptions): Promise<{
    vaultName: string;
    vaultId: string;
    orgSlug?: string;
}>;
declare function orgStatusCommand(): Promise<{
    configured: boolean;
    apiKeySet: boolean;
    vaultIdSet: boolean;
    orgSlug?: string;
    queueDepth: number;
    cloudApiUrl?: string;
}>;
declare function cloudSyncCommand(options?: {
    all?: boolean;
    limit?: number;
}): Promise<Awaited<ReturnType<typeof syncQueuedTraces>>>;
declare function traceEmitCommand(options: TraceEmitOptions): Promise<Awaited<ReturnType<typeof emitTrace>>>;
declare function autoSyncCheckpointCommand(): Promise<Awaited<ReturnType<typeof autoSyncOnCheckpoint>>>;
declare function autoSyncHandoffCommand(): Promise<Awaited<ReturnType<typeof autoSyncOnHandoff>>>;

export { autoSyncCheckpointCommand, autoSyncHandoffCommand, cloudConfigCommand, cloudSyncCommand, orgLinkCommand, orgStatusCommand, traceEmitCommand };
