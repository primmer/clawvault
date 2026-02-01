import { CheckpointData } from './checkpoint.js';

/**
 * Recovery command - detect dirty death and provide recovery info
 */

interface RecoveryInfo {
    died: boolean;
    deathTime: string | null;
    checkpoint: CheckpointData | null;
    handoffPath: string | null;
    handoffContent: string | null;
    recoveryMessage: string;
}
declare function recover(vaultPath: string, clearFlag?: boolean): Promise<RecoveryInfo>;
/**
 * Format recovery info for CLI output
 */
declare function formatRecoveryInfo(info: RecoveryInfo): string;

export { type RecoveryInfo, formatRecoveryInfo, recover };
