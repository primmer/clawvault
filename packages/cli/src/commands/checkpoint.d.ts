/**
 * Quick checkpoint command - fast state save for context death resilience
 */
export interface CheckpointOptions {
    workingOn?: string;
    focus?: string;
    blocked?: string;
    vaultPath: string;
    urgent?: boolean;
}
export interface CheckpointData {
    timestamp: string;
    workingOn: string | null;
    focus: string | null;
    blocked: string | null;
    sessionId?: string;
    sessionKey?: string;
    model?: string;
    tokenEstimate?: number;
    sessionStartedAt?: string;
    urgent?: boolean;
}
export interface SessionState {
    sessionId?: string;
    sessionKey?: string;
    model?: string;
    tokenEstimate?: number;
    startedAt?: string;
}
export declare function flush(): Promise<CheckpointData | null>;
export declare function checkpoint(options: CheckpointOptions): Promise<CheckpointData>;
export declare function clearDirtyFlag(vaultPath: string): Promise<void>;
export declare function cleanExit(vaultPath: string): Promise<void>;
export declare function checkDirtyDeath(vaultPath: string): Promise<{
    died: boolean;
    checkpoint: CheckpointData | null;
    deathTime: string | null;
}>;
export declare function setSessionState(vaultPath: string, session: string | SessionState): Promise<void>;
//# sourceMappingURL=checkpoint.d.ts.map