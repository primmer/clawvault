export interface VaultStatus {
    vaultName: string;
    vaultPath: string;
    health: 'ok' | 'warning';
    issues: string[];
    checkpoint: {
        exists: boolean;
        timestamp?: string;
        age?: string;
        sessionKey?: string;
        model?: string;
        tokenEstimate?: number;
    };
    qmd: {
        collection: string;
        root: string;
        indexStatus: 'present' | 'missing' | 'root-mismatch';
        error?: string;
    };
    graph: {
        indexStatus: 'present' | 'missing' | 'stale';
        generatedAt?: string;
        nodeCount?: number;
        edgeCount?: number;
    };
    observer: {
        staleCount: number;
        oldestMs: number;
        newestMs: number;
    };
    git?: {
        repoRoot: string;
        clean: boolean;
        dirtyCount: number;
    };
    links: {
        total: number;
        orphans: number;
    };
    documents: number;
    categories: Record<string, number>;
}
export declare function getStatus(vaultPath: string, options?: {
    qmdIndexName?: string;
}): Promise<VaultStatus>;
export declare function formatStatus(status: VaultStatus): string;
export declare function statusCommand(vaultPath: string, options?: {
    json?: boolean;
    qmdIndexName?: string;
}): Promise<void>;
//# sourceMappingURL=status.d.ts.map