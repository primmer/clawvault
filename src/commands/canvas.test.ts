import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateCanvas } from './canvas.js';
import { createTask, updateTask, createBacklogItem, completeTask } from '../lib/task-utils.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawvault-canvas-cmd-'));
}

describe('canvas command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    // Create .clawvault directory for graph index
    fs.mkdirSync(path.join(tempDir, '.clawvault'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateCanvas', () => {
    it('generates valid canvas structure', () => {
      const canvas = generateCanvas(tempDir);

      expect(canvas).toHaveProperty('nodes');
      expect(canvas).toHaveProperty('edges');
      expect(Array.isArray(canvas.nodes)).toBe(true);
      expect(Array.isArray(canvas.edges)).toBe(true);
    });

    it('includes knowledge graph group', () => {
      const canvas = generateCanvas(tempDir);
      const knowledgeGraphGroup = canvas.nodes.find(
        n => n.type === 'group' && n.label?.includes('Knowledge Graph')
      );

      expect(knowledgeGraphGroup).toBeDefined();
      expect(knowledgeGraphGroup?.color).toBe('6'); // Purple
    });

    it('includes vault stats group', () => {
      const canvas = generateCanvas(tempDir);
      const statsGroup = canvas.nodes.find(
        n => n.type === 'group' && n.label?.includes('Vault Stats')
      );

      expect(statsGroup).toBeDefined();
      expect(statsGroup?.color).toBe('5'); // Cyan
    });

    it('includes active tasks group when tasks exist', () => {
      createTask(tempDir, 'Active Task One');
      createTask(tempDir, 'Active Task Two');

      const canvas = generateCanvas(tempDir);
      const activeGroup = canvas.nodes.find(
        n => n.type === 'group' && n.label?.includes('Active Tasks')
      );

      expect(activeGroup).toBeDefined();

      // Should have file nodes for tasks
      const fileNodes = canvas.nodes.filter(n => n.type === 'file' && n.file?.startsWith('tasks/'));
      expect(fileNodes.length).toBeGreaterThanOrEqual(2);
    });

    it('includes blocked tasks group when blocked tasks exist', () => {
      const task = createTask(tempDir, 'Blocked Task', { owner: 'alice' });
      updateTask(tempDir, task.slug, { status: 'blocked', blocked_by: 'api-issue' });

      const canvas = generateCanvas(tempDir);
      const blockedGroup = canvas.nodes.find(
        n => n.type === 'group' && n.label?.includes('Blocked')
      );

      expect(blockedGroup).toBeDefined();
      expect(blockedGroup?.color).toBe('1'); // Red
    });

    it('includes backlog group when backlog items exist', () => {
      createBacklogItem(tempDir, 'Backlog Item One');
      createBacklogItem(tempDir, 'Backlog Item Two');

      const canvas = generateCanvas(tempDir);
      const backlogGroup = canvas.nodes.find(
        n => n.type === 'group' && n.label?.includes('Backlog')
      );

      expect(backlogGroup).toBeDefined();
    });

    it('includes recently done group when completed tasks exist', () => {
      const task = createTask(tempDir, 'Done Task');
      completeTask(tempDir, task.slug);

      const canvas = generateCanvas(tempDir);
      const doneGroup = canvas.nodes.find(
        n => n.type === 'group' && n.label?.includes('Recently Done')
      );

      expect(doneGroup).toBeDefined();
      expect(doneGroup?.color).toBe('4'); // Green
    });

    it('includes data flow diagram', () => {
      const canvas = generateCanvas(tempDir);
      const dataFlowGroup = canvas.nodes.find(
        n => n.type === 'group' && n.label === 'Data Flow'
      );

      expect(dataFlowGroup).toBeDefined();

      // Should have edges for the flow
      expect(canvas.edges.length).toBeGreaterThan(0);
    });

    it('applies priority colors to task nodes', () => {
      createTask(tempDir, 'Critical Task', { priority: 'critical' });
      createTask(tempDir, 'High Task', { priority: 'high' });
      createTask(tempDir, 'Medium Task', { priority: 'medium' });

      const canvas = generateCanvas(tempDir);
      const fileNodes = canvas.nodes.filter(n => n.type === 'file' && n.file?.startsWith('tasks/'));

      const criticalNode = fileNodes.find(n => n.file?.includes('critical-task'));
      const highNode = fileNodes.find(n => n.file?.includes('high-task'));
      const mediumNode = fileNodes.find(n => n.file?.includes('medium-task'));

      expect(criticalNode?.color).toBe('1'); // Red
      expect(highNode?.color).toBe('2'); // Orange
      expect(mediumNode?.color).toBe('3'); // Yellow
    });

    it('generates valid node IDs', () => {
      createTask(tempDir, 'Test Task');
      const canvas = generateCanvas(tempDir);

      for (const node of canvas.nodes) {
        expect(node.id).toHaveLength(16);
        expect(/^[0-9a-f]+$/.test(node.id)).toBe(true);
      }
    });

    it('generates valid edge IDs and references', () => {
      createTask(tempDir, 'Test Task');
      const canvas = generateCanvas(tempDir);
      const nodeIds = new Set(canvas.nodes.map(n => n.id));

      for (const edge of canvas.edges) {
        expect(edge.id).toHaveLength(16);
        expect(/^[0-9a-f]+$/.test(edge.id)).toBe(true);
        expect(nodeIds.has(edge.fromNode)).toBe(true);
        expect(nodeIds.has(edge.toNode)).toBe(true);
      }
    });
  });
});
