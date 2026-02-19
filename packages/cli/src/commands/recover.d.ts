/**
 * Recovery command - detect dirty death and provide recovery info
 */
import { CheckpointData } from './checkpoint.js';
export interface RecoveryInfo {
    died: boolean;
    deathTime: string | null;
    checkpoint: CheckpointData | null;
    handoffPath: string | null;
    handoffContent: string | null;
    recoveryMessage: string;
}
export interface RecoveryCheckInfo {
    died: boolean;
    deathTime: string | null;
    checkpoint: CheckpointData | null;
}
export interface ListedCheckpoint extends CheckpointData {
    filePath: string;
}
export declare function checkRecoveryStatus(vaultPath: string): Promise<RecoveryCheckInfo>;
export declare function listCheckpoints(vaultPath: string): ListedCheckpoint[];
export declare function recover(vaultPath: string, options?: {
    clearFlag?: boolean;
    verbose?: boolean;
}): Promise<RecoveryInfo>;
export declare function formatRecoveryCheckStatus(info: RecoveryCheckInfo): string;
export declare function formatCheckpointList(checkpoints: ListedCheckpoint[]): string;
/**
 * Format recovery info for CLI output
 */
export declare function formatRecoveryInfo(info: RecoveryInfo, options?: {
    verbose?: boolean;
}): string;
//# sourceMappingURL=recover.d.ts.map