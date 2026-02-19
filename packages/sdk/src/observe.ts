/**
 * ClawVault SDK — Observe module
 * 
 * Write observations to the vault. Observations are the primary way
 * agents store memories — they go through compression and entity extraction.
 */

import { execFileSync } from 'node:child_process';
import type { ObserveOptions, ObserveResult, ClawVaultConfig } from './types.js';

/**
 * Write an observation to the vault.
 * 
 * The observation goes through ClawVault's observe pipeline:
 * 1. Content is compressed by the LLM compressor
 * 2. Entities are extracted and linked
 * 3. The compressed observation is written to the vault
 * 4. qmd index is updated
 * 
 * @param content - Text content to observe
 * @param config - Vault configuration
 * @param options - Observation options
 */
export function observe(
  content: string,
  config: ClawVaultConfig,
  options: ObserveOptions = {},
): ObserveResult {
  const bin = config.clawvaultBin || 'clawvault';
  const timeout = config.timeout || 30_000;
  
  const args = ['observe', '--json'];
  
  if (config.path) {
    args.push('-v', config.path);
  }
  if (options.actor) {
    args.push('--actor', options.actor);
  }
  if (options.session) {
    args.push('--session', options.session);
  }
  if (options.tags?.length) {
    args.push('--tags', options.tags.join(','));
  }
  if (options.raw) {
    args.push('--raw');
  }
  
  try {
    const result = execFileSync(bin, args, {
      encoding: 'utf-8',
      input: content,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    });
    
    try {
      const parsed = JSON.parse(result);
      return {
        ok: true,
        path: parsed.path || parsed.file,
      };
    } catch {
      // Non-JSON output but no error means success
      return { ok: true };
    }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'observe failed',
    };
  }
}
