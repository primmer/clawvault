import { getPrimitiveRegistryEntry } from './primitive-registry.js';

export const WORKGRAPH_WRITERS = [
  'cli',
  'human',
  'observer',
  'runtime_adapter',
  'trigger_engine',
  'promotion_engine'
] as const;

export type WorkgraphWriter = typeof WORKGRAPH_WRITERS[number];

interface WritePolicyGate {
  gateId: string;
  approved: boolean;
  reason?: string;
}

interface MemoryCorrectionGate {
  enabled: boolean;
  correctionId?: string;
  approvedBy?: string;
}

export interface CanonicalWriteRequest {
  primitive: string;
  writer: WorkgraphWriter;
  policyGate: WritePolicyGate;
  memoryCorrectionGate?: MemoryCorrectionGate;
  vaultPath?: string;
}

const DEFAULT_CUSTOM_CANONICAL_WRITERS: WorkgraphWriter[] = ['cli', 'human'];
const WRITER_POLICY_PROFILES: Record<string, WorkgraphWriter[]> = {
  human_cli: ['cli', 'human'],
  automation: ['cli', 'human', 'trigger_engine'],
  observer_ingest: ['observer', 'runtime_adapter'],
  promotion: ['promotion_engine', 'cli', 'human']
};

function normalizePrimitiveName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeConfiguredWriters(configured: string[]): WorkgraphWriter[] {
  return [...new Set(
    configured
      .map((entry) => entry.trim())
      .filter((entry): entry is WorkgraphWriter => isWorkgraphWriter(entry))
  )];
}

export function allowedWritersForPrimitive(
  primitive: string,
  options: { vaultPath?: string } = {}
): WorkgraphWriter[] {
  const normalizedPrimitive = normalizePrimitiveName(primitive);
  const registryEntry = getPrimitiveRegistryEntry(normalizedPrimitive, {
    vaultPath: options.vaultPath
  });
  if (!registryEntry?.canonical) {
    return [];
  }
  const configured = normalizeConfiguredWriters(registryEntry.writers);
  if (configured.length > 0) {
    return configured;
  }
  const profileWriters = registryEntry.writerPolicyProfile
    ? WRITER_POLICY_PROFILES[registryEntry.writerPolicyProfile]
    : undefined;
  if (profileWriters) {
    return [...profileWriters];
  }
  return [...DEFAULT_CUSTOM_CANONICAL_WRITERS];
}

export function isWorkgraphWriter(value: string): value is WorkgraphWriter {
  return (WORKGRAPH_WRITERS as readonly string[]).includes(value);
}

function assertGateApproved(gate: WritePolicyGate): void {
  if (!gate.gateId.trim()) {
    throw new Error('Canonical writes require a non-empty policy gate id.');
  }
  if (!gate.approved) {
    throw new Error(`Canonical write denied by policy gate "${gate.gateId}".`);
  }
}

function assertMemoryCorrectionGate(
  primitive: string,
  writer: WorkgraphWriter,
  correctionGate?: MemoryCorrectionGate
): void {
  if (normalizePrimitiveName(primitive) !== 'memory_event') return;
  if (writer === 'observer' || writer === 'runtime_adapter') return;

  if (!correctionGate?.enabled) {
    throw new Error(
      'Direct canonical memory_event writes are forbidden. Use explicit policy-gated correction flow.'
    );
  }
  if (!correctionGate.correctionId?.trim()) {
    throw new Error('Memory correction flow requires a correctionId.');
  }
  if (!correctionGate.approvedBy?.trim()) {
    throw new Error('Memory correction flow requires approvedBy.');
  }
}

export function assertCanonicalWriteAllowed(request: CanonicalWriteRequest): void {
  const { primitive, writer, policyGate, memoryCorrectionGate, vaultPath } = request;
  assertGateApproved(policyGate);

  const allowedWriters = allowedWritersForPrimitive(primitive, { vaultPath });
  if (!allowedWriters.includes(writer)) {
    throw new Error(`Writer "${writer}" is not allowed to write canonical primitive "${primitive}".`);
  }

  assertMemoryCorrectionGate(primitive, writer, memoryCorrectionGate);
}
