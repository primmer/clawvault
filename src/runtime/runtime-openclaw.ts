import { spawnSync } from 'node:child_process';
import { normalizeOpenClawEvent } from './openclaw-adapter.js';
import type { RuntimeAdapter } from './types.js';

export interface OpenClawAdapterStatus {
  ok: boolean;
  details: string[];
}

export const DEFAULT_OPENCLAW_HOOK = 'clawvault';
const OPENCLAW_COMMAND_TIMEOUT_MS = 15_000;
const OPENCLAW_MAX_BUFFER_BYTES = 1_048_576;
const OPENCLAW_HOOK_NAME_RE = /^[A-Za-z0-9:_-]+$/;
const OPENCLAW_SPAWN_OPTIONS = {
  encoding: 'utf-8' as const,
  timeout: OPENCLAW_COMMAND_TIMEOUT_MS,
  maxBuffer: OPENCLAW_MAX_BUFFER_BYTES
};

export function normalizeOpenClawHookName(hookName: string | undefined): string {
  if (typeof hookName !== 'string') {
    return DEFAULT_OPENCLAW_HOOK;
  }
  const normalized = hookName.trim();
  if (!normalized) {
    return DEFAULT_OPENCLAW_HOOK;
  }
  if (!OPENCLAW_HOOK_NAME_RE.test(normalized)) {
    throw new Error(`Invalid OpenClaw hook name: ${hookName}`);
  }
  return normalized;
}

function runOpenClaw(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync('openclaw', args, OPENCLAW_SPAWN_OPTIONS);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const errorMessage = result.error?.message?.trim();
  const diagnostic = output && errorMessage
    ? `${output} | ${errorMessage}`
    : output || errorMessage || '';
  const ok = !result.error && result.status === 0;
  return { ok, output: diagnostic };
}

function formatStepDetail(step: string, result: { ok: boolean; output: string }): string {
  if (result.ok) {
    return `${step}: ok`;
  }
  if (!result.output) {
    return `${step}: failed`;
  }
  return `${step}: failed (${result.output})`;
}

export function installOpenClawAdapter(hookName?: string): OpenClawAdapterStatus {
  const normalizedHookName = normalizeOpenClawHookName(hookName);
  const details: string[] = [];
  const install = runOpenClaw(['hooks', 'install', normalizedHookName]);
  details.push(formatStepDetail('install', install));
  if (!install.ok) {
    details.push('enable: skipped');
    return {
      ok: false,
      details
    };
  }

  const enable = runOpenClaw(['hooks', 'enable', normalizedHookName]);
  details.push(formatStepDetail('enable', enable));
  return {
    ok: install.ok && enable.ok,
    details
  };
}

export function verifyOpenClawAdapter(hookName?: string): OpenClawAdapterStatus {
  const normalizedHookName = normalizeOpenClawHookName(hookName);
  const details: string[] = [];
  const version = runOpenClaw(['--version']);
  if (!version.ok) {
    details.push(version.output
      ? `openclaw binary unavailable (${version.output})`
      : 'openclaw binary unavailable');
    return {
      ok: false,
      details
    };
  }
  details.push(`openclaw version detected`);

  const info = runOpenClaw(['hooks', 'info', normalizedHookName]);
  if (!info.ok) {
    details.push(info.output
      ? `hook info unavailable for "${normalizedHookName}" (${info.output})`
      : `hook info unavailable for "${normalizedHookName}"`);
    return {
      ok: false,
      details
    };
  }
  details.push(`hook "${normalizedHookName}" installed`);
  return {
    ok: true,
    details
  };
}

export function uninstallOpenClawAdapter(hookName?: string): OpenClawAdapterStatus {
  const normalizedHookName = normalizeOpenClawHookName(hookName);
  const details: string[] = [];
  const disable = runOpenClaw(['hooks', 'disable', normalizedHookName]);
  details.push(formatStepDetail('disable', disable));
  const remove = runOpenClaw(['hooks', 'remove', normalizedHookName]);
  details.push(formatStepDetail('remove', remove));
  return {
    ok: disable.ok && remove.ok,
    details
  };
}

export const openclawRuntimePluginAdapter: RuntimeAdapter<Record<string, unknown>> = {
  install: () => {
    const result = installOpenClawAdapter();
    if (!result.ok) {
      throw new Error(result.details.join('; '));
    }
  },
  verify: () => verifyOpenClawAdapter(),
  uninstall: () => {
    const result = uninstallOpenClawAdapter();
    if (!result.ok) {
      throw new Error(result.details.join('; '));
    }
  },
  normalizeEvent: normalizeOpenClawEvent
};
