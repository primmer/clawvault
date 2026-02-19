/**
 * Primitives removed in v3 — used for backwards-compat error messages.
 */
export const REMOVED_V3_PRIMITIVES = [
  'goal', 'agent', 'state_space', 'feedback', 'capital',
  'institution', 'synthesis_operator', 'recursion_operator',
];

export const REMOVED_V3_PRIMITIVE_SET = new Set(REMOVED_V3_PRIMITIVES);
