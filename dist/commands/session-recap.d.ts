type SessionRecapFormat = 'markdown' | 'json';
type SessionRole = 'user' | 'assistant';
interface SessionRecapOptions {
    limit?: number;
    format?: SessionRecapFormat;
    agentId?: string;
}
interface SessionTurn {
    role: SessionRole;
    text: string;
}
interface SessionRecapResult {
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
declare function formatSessionRecapMarkdown(result: SessionRecapResult): string;
declare function buildSessionRecap(sessionKeyInput: string, options?: SessionRecapOptions): Promise<SessionRecapResult>;
declare function sessionRecapCommand(sessionKey: string, options?: SessionRecapOptions): Promise<void>;

export { type SessionRecapFormat, type SessionRecapOptions, type SessionRecapResult, type SessionRole, type SessionTurn, buildSessionRecap, formatSessionRecapMarkdown, sessionRecapCommand };
