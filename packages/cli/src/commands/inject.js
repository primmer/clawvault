import * as path from 'path';
import { listConfig } from '@versatly/clawvault-core/lib/config-manager.js';
import { runPromptInjection } from '@versatly/clawvault-core/lib/inject-utils.js';
function asPositiveInteger(value, fallback) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return fallback;
}
function asBoolean(value, fallback) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) {
            return true;
        }
        if (['false', '0', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }
    return fallback;
}
function asStringArray(value, fallback) {
    if (Array.isArray(value)) {
        const normalized = value
            .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
            .map((entry) => entry.trim())
            .filter(Boolean);
        if (normalized.length > 0) {
            return normalized;
        }
    }
    if (typeof value === 'string') {
        const normalized = value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
        if (normalized.length > 0) {
            return normalized;
        }
    }
    return fallback;
}
function readInjectConfig(vaultPath) {
    const config = listConfig(vaultPath);
    const inject = config.inject ?? {};
    return {
        maxResults: asPositiveInteger(inject.maxResults, 8),
        useLlm: asBoolean(inject.useLlm, true),
        scope: asStringArray(inject.scope, ['global'])
    };
}
function formatReasons(match) {
    return match.reasons
        .map((reason) => `${reason.source}:${reason.value}`)
        .join(' | ');
}
function formatInjectMarkdown(result) {
    const lines = [];
    lines.push(`## Prompt Injection for: ${result.message}`);
    lines.push('');
    lines.push(`- Deterministic matching: ${result.deterministicMs}ms`);
    lines.push(`- LLM fuzzy matching: ${result.usedLlm ? `enabled (${result.llmProvider})` : 'disabled'}`);
    lines.push('');
    if (result.matches.length === 0) {
        lines.push('_No injectable rules matched this message._');
        return lines.join('\n');
    }
    for (const [index, match] of result.matches.entries()) {
        lines.push(`### ${index + 1}. ${match.item.title}`);
        lines.push(`- Path: ${match.item.relativePath}`);
        lines.push(`- Category: ${match.item.category}`);
        lines.push(`- Priority: ${match.item.priority}`);
        lines.push(`- Score: ${match.score.toFixed(2)}`);
        lines.push(`- Match sources: ${formatReasons(match)}`);
        lines.push('');
        lines.push(match.item.content || '_No content._');
        lines.push('');
    }
    return lines.join('\n').trimEnd();
}
export async function buildInjectionResult(message, options) {
    const normalizedMessage = message.trim();
    if (!normalizedMessage) {
        throw new Error('Message is required for inject.');
    }
    const vaultPath = path.resolve(options.vaultPath);
    const config = readInjectConfig(vaultPath);
    const maxResults = options.maxResults ?? config.maxResults;
    const useLlm = options.useLlm ?? config.useLlm;
    const scope = options.scope ?? config.scope;
    return runPromptInjection(vaultPath, normalizedMessage, {
        maxResults,
        useLlm,
        scope,
        model: options.model
    });
}
export async function injectCommand(message, options) {
    const result = await buildInjectionResult(message, options);
    if ((options.format ?? 'markdown') === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    console.log(formatInjectMarkdown(result));
}
function parsePositiveInteger(raw, label) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid ${label}: ${raw}`);
    }
    return parsed;
}
export function registerInjectCommand(program) {
    program
        .command('inject <message>')
        .description('Inject rules, decisions, and preferences into your prompt context')
        .option('-v, --vault <path>', 'Vault path')
        .option('-n, --max-results <n>', 'Maximum number of injected items')
        .option('--scope <scope>', 'Comma-separated scope filter override')
        .option('--enable-llm', 'Enable optional LLM fuzzy intent matching')
        .option('--disable-llm', 'Disable optional LLM fuzzy intent matching')
        .option('--format <format>', 'Output format (markdown|json)', 'markdown')
        .option('--model <model>', 'Override LLM model when fuzzy matching is enabled')
        .action(async (message, rawOptions) => {
        const format = rawOptions.format === 'json' ? 'json' : 'markdown';
        const useLlm = rawOptions.enableLlm
            ? true
            : rawOptions.disableLlm
                ? false
                : undefined;
        await injectCommand(message, {
            vaultPath: rawOptions.vault ?? process.env.CLAWVAULT_PATH ?? process.cwd(),
            maxResults: rawOptions.maxResults
                ? parsePositiveInteger(rawOptions.maxResults, 'max-results')
                : undefined,
            useLlm,
            scope: rawOptions.scope,
            format,
            model: rawOptions.model
        });
    });
}
//# sourceMappingURL=inject.js.map