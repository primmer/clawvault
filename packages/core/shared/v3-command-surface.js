/**
 * Legacy commands removed in v3 and reserved command names.
 */
export const LEGACY_REMOVED_TOP_LEVEL_COMMANDS = [
  'add', 'remove', 'update', 'list', 'show', 'create', 'delete',
];

export const LEGACY_REMOVED_TOP_LEVEL_COMMAND_VARIANTS = [
  'add-task', 'remove-task', 'update-task', 'list-tasks',
  'add-goal', 'remove-goal', 'update-goal', 'list-goals',
];

export const RESERVED_NON_WORKFLOW_COMMANDS = [
  'init', 'setup', 'config', 'doctor', 'status', 'help', 'version',
  'search', 'graph', 'embed', 'observe', 'reflect', 'replay',
  'archive', 'rebuild', 'inject', 'context', 'template', 'compat',
  'task', 'project', 'kanban', 'backlog', 'blocked', 'entities',
  'wake', 'sleep', 'checkpoint', 'recover', 'reweave', 'migrate-observations',
  'session-recap', 'repair-session', 'link', 'shell-init',
];
