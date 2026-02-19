export type SessionRecapFormat = 'markdown' | 'json';
export type SessionRole = 'user' | 'assistant';
export interface SessionRecapOptions {
    limit?: number;
    format?: SessionRecapFormat;
    agentId?: string;
}
export interface SessionTurn {
    role: SessionRole;
    text: string;
}
export interface SessionRecapResult {
    sessionKey: string;
    sessionLabel: string;
    agentId: string;
    sessionId: string;
    transcriptPath: string;
    generated: string;
    count: number;
    messages: SessionTurn[];
    markdown: string;
}
export declare function formatSessionRecapMarkdown(result: SessionRecapResult): string;
export declare function buildSessionRecap(sessionKeyInput: string, options?: SessionRecapOptions): Promise<SessionRecapResult>;
export declare function sessionRecapCommand(sessionKey: string, options?: SessionRecapOptions): Promise<void>;
//# sourceMappingURL=session-recap.d.ts.map