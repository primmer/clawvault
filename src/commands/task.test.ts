import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  taskAdd,
  taskList,
  taskUpdate,
  taskDone,
  taskShow,
  formatTaskList,
  formatTaskDetails
} from './task.js';
import { createTask, updateTask } from '../lib/task-utils.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-task-cmd-'));
}

describe('task command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('taskAdd', () => {
    it('creates a new task', () => {
      const task = taskAdd(tempDir, 'New Task', {
        owner: 'test',
        priority: 'high'
      });

      expect(task.slug).toBe('new-task');
      expect(task.frontmatter.owner).toBe('test');
      expect(task.frontmatter.priority).toBe('high');
    });
  });

  describe('taskList', () => {
    beforeEach(() => {
      createTask(tempDir, 'Task A', { owner: 'alice', priority: 'high' });
      createTask(tempDir, 'Task B', { owner: 'bob', priority: 'low' });
      const doneTask = createTask(tempDir, 'Task C', { owner: 'alice' });
      updateTask(tempDir, doneTask.slug, { status: 'done' });
    });

    it('lists non-done tasks by default', () => {
      const tasks = taskList(tempDir);
      expect(tasks).toHaveLength(2);
      expect(tasks.every(t => t.frontmatter.status !== 'done')).toBe(true);
    });

    it('filters by status', () => {
      const tasks = taskList(tempDir, { status: 'done' });
      expect(tasks).toHaveLength(1);
    });

    it('filters by owner', () => {
      const tasks = taskList(tempDir, { owner: 'alice' });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].frontmatter.owner).toBe('alice');
    });
  });

  describe('taskUpdate', () => {
    it('updates task fields', () => {
      createTask(tempDir, 'Update Me');
      const updated = taskUpdate(tempDir, 'update-me', {
        status: 'in-progress',
        priority: 'critical'
      });

      expect(updated.frontmatter.status).toBe('in-progress');
      expect(updated.frontmatter.priority).toBe('critical');
    });

    it('sets blocked_by when blocking', () => {
      createTask(tempDir, 'Block Me');
      const updated = taskUpdate(tempDir, 'block-me', {
        status: 'blocked',
        blockedBy: 'api-issue'
      });

      expect(updated.frontmatter.status).toBe('blocked');
      expect(updated.frontmatter.blocked_by).toBe('api-issue');
    });
  });

  describe('taskDone', () => {
    it('marks task as done', () => {
      createTask(tempDir, 'Complete Me');
      const done = taskDone(tempDir, 'complete-me');

      expect(done.frontmatter.status).toBe('done');
      expect(done.frontmatter.completed).toBeDefined();
    });
  });

  describe('taskShow', () => {
    it('returns task details', () => {
      createTask(tempDir, 'Show Me', { owner: 'test', priority: 'high' });
      const task = taskShow(tempDir, 'show-me');

      expect(task).not.toBeNull();
      expect(task?.title).toBe('Show Me');
      expect(task?.frontmatter.owner).toBe('test');
    });

    it('returns null for non-existent task', () => {
      const task = taskShow(tempDir, 'non-existent');
      expect(task).toBeNull();
    });
  });

  describe('formatTaskList', () => {
    it('formats empty list', () => {
      const output = formatTaskList([]);
      expect(output).toContain('No tasks found');
    });

    it('formats task list with headers', () => {
      createTask(tempDir, 'Format Test', { owner: 'alice', priority: 'high', project: 'proj' });
      const tasks = taskList(tempDir);
      const output = formatTaskList(tasks);

      expect(output).toContain('STATUS');
      expect(output).toContain('OWNER');
      expect(output).toContain('PRIORITY');
      expect(output).toContain('PROJECT');
      expect(output).toContain('TITLE');
      expect(output).toContain('alice');
      expect(output).toContain('high');
      expect(output).toContain('proj');
      expect(output).toContain('Format Test');
    });

    it('shows correct status icons', () => {
      createTask(tempDir, 'Open Task');
      const openTask = createTask(tempDir, 'Active Task');
      updateTask(tempDir, openTask.slug, { status: 'in-progress' });
      const blockedTask = createTask(tempDir, 'Blocked Task');
      updateTask(tempDir, blockedTask.slug, { status: 'blocked', blocked_by: 'issue' });

      const tasks = taskList(tempDir);
      const output = formatTaskList(tasks);

      expect(output).toContain('○'); // open
      expect(output).toContain('●'); // active
      expect(output).toContain('■'); // blocked
    });
  });

  describe('formatTaskDetails', () => {
    it('formats task details', () => {
      const task = createTask(tempDir, 'Detail Test', {
        owner: 'alice',
        project: 'proj',
        priority: 'high',
        due: '2026-02-20'
      });

      const output = formatTaskDetails(task);

      expect(output).toContain('# Detail Test');
      expect(output).toContain('Status:');
      expect(output).toContain('Owner: alice');
      expect(output).toContain('Project: proj');
      expect(output).toContain('Priority: high');
      expect(output).toContain('Due: 2026-02-20');
      expect(output).toContain('Created:');
      expect(output).toContain('File:');
    });
  });
});
