/**
 * ClawVault SDK — Context module
 * 
 * Retrieve context for agent sessions. Context combines search results,
 * user preferences, and recent observations into a single coherent blob
 * that can be injected into agent prompts.
 */

import { execFileSync } from 'node:child_process';
import type { ContextOptions, ContextResult, ClawVaultConfig } from './types.js';

/**
 * Retrieve context for an agent session.
 * 
 * Uses ClawVault's context command to build a contextual summary
 * combining recent observations, relevant vault knowledge, and
 * user preferences.
 * 
 * @param config - Vault configuration
 * @param options - Context retrieval options
 */
export function context(
  config: ClawVaultConfig,
  options: ContextOptions = {},
): ContextResult {
  const bin = config.clawvaultBin || 'clawvault';
  const timeout = config.timeout || 30_000;
  
  const args = ['context'];
  
  if (config.path) {
    args.push('-v', config.path);
  }
  if (options.session) {
    args.push('--session', options.session);
  }
  if (options.maxChars) {
    args.push('--max-chars', String(options.maxChars));
  }
  
  try {
    const result = execFileSync(bin, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    });
    
    return {
      text: result.trim(),
      sources: [], // TODO: parse source annotations from context output
      charCount: result.trim().length,
    };
  } catch (err: any) {
    return {
      text: '',
      sources: [],
      charCount: 0,
    };
  }
}
