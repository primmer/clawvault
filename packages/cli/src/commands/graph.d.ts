export interface GraphSummary {
    schemaVersion: number;
    generatedAt: string;
    nodeCount: number;
    edgeCount: number;
    nodeTypeCounts: Record<string, number>;
    edgeTypeCounts: Record<string, number>;
    fileCount: number;
}
export declare function graphSummary(options?: {
    vaultPath?: string;
    refresh?: boolean;
    json?: boolean;
}): Promise<GraphSummary>;
export declare function graphCommand(options?: {
    vaultPath?: string;
    refresh?: boolean;
    json?: boolean;
}): Promise<void>;
//# sourceMappingURL=graph.d.ts.map