/**
 * ClawVault Plugin v2 — Adaptive Retrieval
 *
 * Determines whether memory retrieval should be skipped for a given input.
 * Skips retrieval for:
 * - Greetings and farewells
 * - Slash commands (e.g., /help, /status)
 * - Confirmations and acknowledgments
 * - Emoji-only messages
 * - Very short non-informational messages
 * - System/heartbeat messages
 */

export interface AdaptiveConfig {
  enabled: boolean;
  /** Additional user-defined skip patterns (regex strings) */
  skipPatterns: string[];
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveConfig = {
  enabled: true,
  skipPatterns: [],
};

export type SkipReason =
  | 'greeting'
  | 'farewell'
  | 'slash_command'
  | 'confirmation'
  | 'emoji_only'
  | 'too_short'
  | 'system_message'
  | 'user_pattern';

export interface AdaptiveResult {
  shouldRetrieve: boolean;
  skipReason?: SkipReason;
}

// ─── Skip patterns ──────────────────────────────────────────────────────────

const GREETING_RE = /^(?:hi|hello|hey|howdy|greetings|good (?:morning|afternoon|evening)|what'?s up|sup|yo)\b/i;

const FAREWELL_RE = /^(?:bye|goodbye|see you|later|gn|good night|cya|take care)\s*[!.?]*$/i;

const SLASH_COMMAND_RE = /^\/\w+/;

const CONFIRMATION_RE = /^(?:ok(?:ay)?|sure|yes|no|yep|nope|y|n|got it|understood|perfect|great|cool|nice|awesome|k|kk|ack|confirmed|roger)\s*[!.?]*$/i;

const EMOJI_ONLY_RE = /^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Component}\s]+$/u;

const SYSTEM_RE = /^(?:\[System|\[HEARTBEAT|NO_REPLY|<relevant-memories|<session-recap)/;

const MIN_MEANINGFUL_LENGTH = 8;

/**
 * Determine whether retrieval should be performed for the given input.
 */
export function shouldRetrieve(
  input: string,
  config: AdaptiveConfig = DEFAULT_ADAPTIVE_CONFIG,
): AdaptiveResult {
  if (!config.enabled) return { shouldRetrieve: true };
  if (!input) return { shouldRetrieve: false, skipReason: 'too_short' };

  const trimmed = input.trim();

  // System messages
  if (SYSTEM_RE.test(trimmed)) {
    return { shouldRetrieve: false, skipReason: 'system_message' };
  }

  // Slash commands
  if (SLASH_COMMAND_RE.test(trimmed)) {
    return { shouldRetrieve: false, skipReason: 'slash_command' };
  }

  // Emoji-only
  if (EMOJI_ONLY_RE.test(trimmed)) {
    return { shouldRetrieve: false, skipReason: 'emoji_only' };
  }

  // Too short
  if (trimmed.length < MIN_MEANINGFUL_LENGTH) {
    return { shouldRetrieve: false, skipReason: 'too_short' };
  }

  // Greetings
  if (GREETING_RE.test(trimmed) && trimmed.length < 30) {
    return { shouldRetrieve: false, skipReason: 'greeting' };
  }

  // Farewells
  if (FAREWELL_RE.test(trimmed)) {
    return { shouldRetrieve: false, skipReason: 'farewell' };
  }

  // Confirmations
  if (CONFIRMATION_RE.test(trimmed)) {
    return { shouldRetrieve: false, skipReason: 'confirmation' };
  }

  // User-defined skip patterns
  for (const pattern of config.skipPatterns) {
    try {
      const re = new RegExp(pattern, 'i');
      if (re.test(trimmed)) {
        return { shouldRetrieve: false, skipReason: 'user_pattern' };
      }
    } catch {
      // Invalid regex — skip it
    }
  }

  return { shouldRetrieve: true };
}
