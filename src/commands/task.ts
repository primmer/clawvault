/**
 * Task command for ClawVault
 * Manages task add/list/update/done/show operations
 */

import {
  createTask,
  listTasks,
  readTask,
  updateTask,
  completeTask,
  getStatusIcon,
  getStatusDisplay,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type TaskFilterOptions
} from '../lib/task-utils.js';

export interface TaskAddOptions {
  owner?: string;
  project?: string;
  priority?: TaskPriority;
  due?: string;
  content?: string;
  tags?: string[];
}

export interface TaskListOptions {
  status?: TaskStatus;
  owner?: string;
  project?: string;
  priority?: TaskPriority;
  json?: boolean;
}

export interface TaskUpdateOptions {
  status?: TaskStatus;
  owner?: string;
  project?: string;
  priority?: TaskPriority;
  blockedBy?: string;
  due?: string;
}

export interface TaskShowOptions {
  json?: boolean;
}

/**
 * Add a new task
 */
export function taskAdd(vaultPath: string, title: string, options: TaskAddOptions = {}): Task {
  return createTask(vaultPath, title, {
    owner: options.owner,
    project: options.project,
    priority: options.priority,
    due: options.due,
    content: options.content,
    tags: options.tags
  });
}

/**
 * List tasks with optional filters
 */
export function taskList(vaultPath: string, options: TaskListOptions = {}): Task[] {
  const filters: TaskFilterOptions = {};
  
  if (options.status) filters.status = options.status;
  if (options.owner) filters.owner = options.owner;
  if (options.project) filters.project = options.project;
  if (options.priority) filters.priority = options.priority;

  // By default, show open and in-progress tasks (not done)
  if (!options.status) {
    const allTasks = listTasks(vaultPath, filters);
    return allTasks.filter(t => t.frontmatter.status !== 'done');
  }

  return listTasks(vaultPath, filters);
}

/**
 * Update a task
 */
export function taskUpdate(vaultPath: string, slug: string, options: TaskUpdateOptions): Task {
  return updateTask(vaultPath, slug, {
    status: options.status,
    owner: options.owner,
    project: options.project,
    priority: options.priority,
    blocked_by: options.blockedBy,
    due: options.due
  });
}

/**
 * Mark a task as done
 */
export function taskDone(vaultPath: string, slug: string): Task {
  return completeTask(vaultPath, slug);
}

/**
 * Show task details
 */
export function taskShow(vaultPath: string, slug: string): Task | null {
  return readTask(vaultPath, slug);
}

/**
 * Format task list as terminal table
 */
export function formatTaskList(tasks: Task[]): string {
  if (tasks.length === 0) {
    return 'No tasks found.\n';
  }

  // Calculate column widths
  const headers = ['STATUS', 'OWNER', 'PRIORITY', 'PROJECT', 'TITLE'];
  const widths = [10, 12, 8, 16, 40];

  // Build header row
  let output = headers.map((h, i) => h.padEnd(widths[i])).join('  ') + '\n';

  // Build task rows
  for (const task of tasks) {
    const icon = getStatusIcon(task.frontmatter.status);
    const statusDisplay = getStatusDisplay(task.frontmatter.status);
    const status = `${icon} ${statusDisplay}`;
    const owner = task.frontmatter.owner || '-';
    const priority = task.frontmatter.priority || 'low';
    const project = task.frontmatter.project || '-';
    const title = task.title.length > widths[4] 
      ? task.title.slice(0, widths[4] - 3) + '...'
      : task.title;

    const row = [
      status.padEnd(widths[0]),
      owner.padEnd(widths[1]),
      priority.padEnd(widths[2]),
      project.padEnd(widths[3]),
      title
    ];

    output += row.join('  ') + '\n';
  }

  return output;
}

/**
 * Format task details for display
 */
export function formatTaskDetails(task: Task): string {
  let output = '';
  
  output += `# ${task.title}\n`;
  output += '-'.repeat(40) + '\n';
  output += `Status: ${getStatusIcon(task.frontmatter.status)} ${getStatusDisplay(task.frontmatter.status)}\n`;
  
  if (task.frontmatter.owner) {
    output += `Owner: ${task.frontmatter.owner}\n`;
  }
  if (task.frontmatter.project) {
    output += `Project: ${task.frontmatter.project}\n`;
  }
  if (task.frontmatter.priority) {
    output += `Priority: ${task.frontmatter.priority}\n`;
  }
  if (task.frontmatter.due) {
    output += `Due: ${task.frontmatter.due}\n`;
  }
  if (task.frontmatter.blocked_by) {
    output += `Blocked by: ${task.frontmatter.blocked_by}\n`;
  }
  if (task.frontmatter.tags && task.frontmatter.tags.length > 0) {
    output += `Tags: ${task.frontmatter.tags.join(', ')}\n`;
  }
  
  output += `Created: ${task.frontmatter.created}\n`;
  output += `Updated: ${task.frontmatter.updated}\n`;
  
  if (task.frontmatter.completed) {
    output += `Completed: ${task.frontmatter.completed}\n`;
  }
  
  output += `File: ${task.path}\n`;
  output += '-'.repeat(40) + '\n';
  
  // Show content (without the title line)
  const contentWithoutTitle = task.content.replace(/^#\s+.+\n/, '').trim();
  if (contentWithoutTitle) {
    output += '\n' + contentWithoutTitle + '\n';
  }

  return output;
}

/**
 * Task command handler for CLI
 */
export async function taskCommand(
  vaultPath: string,
  action: 'add' | 'list' | 'update' | 'done' | 'show',
  args: {
    title?: string;
    slug?: string;
    options?: TaskAddOptions & TaskListOptions & TaskUpdateOptions & TaskShowOptions;
  }
): Promise<void> {
  const options = args.options || {};

  switch (action) {
    case 'add': {
      if (!args.title) {
        throw new Error('Title is required for task add');
      }
      const task = taskAdd(vaultPath, args.title, options);
      console.log(`✓ Created task: ${task.slug}`);
      console.log(`  Path: ${task.path}`);
      break;
    }

    case 'list': {
      const tasks = taskList(vaultPath, options);
      if (options.json) {
        console.log(JSON.stringify(tasks, null, 2));
      } else {
        console.log(formatTaskList(tasks));
      }
      break;
    }

    case 'update': {
      if (!args.slug) {
        throw new Error('Task slug is required for update');
      }
      const task = taskUpdate(vaultPath, args.slug, options);
      console.log(`✓ Updated task: ${task.slug}`);
      break;
    }

    case 'done': {
      if (!args.slug) {
        throw new Error('Task slug is required for done');
      }
      const task = taskDone(vaultPath, args.slug);
      console.log(`✓ Completed task: ${task.slug}`);
      break;
    }

    case 'show': {
      if (!args.slug) {
        throw new Error('Task slug is required for show');
      }
      const task = taskShow(vaultPath, args.slug);
      if (!task) {
        throw new Error(`Task not found: ${args.slug}`);
      }
      if (options.json) {
        console.log(JSON.stringify(task, null, 2));
      } else {
        console.log(formatTaskDetails(task));
      }
      break;
    }

    default:
      throw new Error(`Unknown task action: ${action}`);
  }
}
