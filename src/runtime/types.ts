export type RuntimeEventKind =
  | 'startup'
  | 'heartbeat'
  | 'session_start'
  | 'session_new'
  | 'session_reset'
  | 'compaction'
  | 'weekly'
  | 'unknown';

export interface RuntimeEvent {
  kind: RuntimeEventKind;
  source: 'openclaw' | 'claude-code' | 'unknown';
  eventName: string;
  timestamp: string;
  sessionKey?: string;
  payload: Record<string, unknown>;
}

export interface RuntimeAdapter<TInput = unknown> {
  install?(options?: Record<string, unknown>): Promise<void> | void;
  verify?(options?: Record<string, unknown>): Promise<{ ok: boolean; details?: string[] }> | { ok: boolean; details?: string[] };
  uninstall?(options?: Record<string, unknown>): Promise<void> | void;
  normalizeEvent(input: TInput): RuntimeEvent[];
}
