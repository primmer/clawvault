export interface SetupOptions {
    graphColors?: boolean;
    bases?: boolean;
    theme?: 'neural' | 'minimal' | 'none';
    force?: boolean;
    vault?: string;
    qmdIndexName?: string;
}
export interface ExtractedPerson {
    name: string;
    email?: string;
    role?: string;
    context?: string;
}
export interface ExtractedPreference {
    subject: string;
    preference: string;
    context?: string;
}
export interface ExtractedDecision {
    title: string;
    decision: string;
    context?: string;
}
export interface ExtractedTask {
    title: string;
    description?: string;
    priority?: 'critical' | 'high' | 'medium' | 'low';
}
export interface ExtractionResult {
    people: ExtractedPerson[];
    preferences: ExtractedPreference[];
    decisions: ExtractedDecision[];
    tasks: ExtractedTask[];
}
export interface ImportSummary {
    created: {
        people: string[];
        preferences: string[];
        decisions: string[];
        tasks: string[];
    };
    skipped: {
        people: string[];
        preferences: string[];
        decisions: string[];
        tasks: string[];
    };
}
/**
 * Extract people mentioned in text using heuristics
 * Looks for patterns like:
 * - Names with email: "John Smith <john@example.com>"
 * - Names with roles: "John Smith (CTO)", "John Smith, CEO"
 * - Capitalized names after certain keywords: "met with John Smith", "contact John Smith"
 */
export declare function extractPeople(content: string): ExtractedPerson[];
/**
 * Extract preferences from text using heuristics
 * Looks for patterns like:
 * - "prefers X", "prefer X", "I prefer X"
 * - "likes X", "like X", "I like X"
 * - "always use X", "never use X"
 * - "favorite X is Y"
 */
export declare function extractPreferences(content: string): ExtractedPreference[];
/**
 * Extract decisions from text using heuristics
 * Looks for patterns like:
 * - "decided to X"
 * - "decision: X"
 * - "we chose X"
 * - "going with X"
 */
export declare function extractDecisions(content: string): ExtractedDecision[];
/**
 * Extract tasks/todos from text using heuristics
 * Looks for patterns like:
 * - "- [ ] task" (markdown checkbox)
 * - "TODO: task"
 * - "need to X"
 * - "should X"
 */
export declare function extractTasks(content: string): ExtractedTask[];
/**
 * Extract all structured data from markdown content
 */
export declare function extractFromContent(content: string): ExtractionResult;
/**
 * Scan a source directory and extract all structured data
 */
export declare function scanAndExtract(sourcePath: string): ExtractionResult;
/**
 * Import extracted data into the vault
 */
export declare function importToVault(vaultPath: string, extracted: ExtractionResult, force: boolean): ImportSummary;
export declare function setupCommand(options?: SetupOptions): Promise<void>;
//# sourceMappingURL=setup.d.ts.map