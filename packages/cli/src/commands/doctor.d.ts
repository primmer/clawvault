export type DoctorStatus = 'ok' | 'warn' | 'error';
export interface DoctorCheck {
    label: string;
    status: DoctorStatus;
    detail?: string;
    hint?: string;
}
export interface DoctorReport {
    vaultPath?: string;
    qmdCollection?: string;
    qmdRoot?: string;
    checks: DoctorCheck[];
    warnings: number;
    errors: number;
}
export declare function doctor(options?: string | {
    vaultPath?: string;
    fix?: boolean;
}): Promise<DoctorReport>;
//# sourceMappingURL=doctor.d.ts.map