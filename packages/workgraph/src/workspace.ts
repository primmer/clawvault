/**
 * Workgraph workspace lifecycle (agent-first, no memory scaffolding).
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry, saveRegistry, listTypes } from './registry.js';
import type { WorkgraphWorkspaceConfig } from './types.js';

const WORKGRAPH_CONFIG_FILE = '.workgraph.json';

export interface InitWorkspaceOptions {
  name?: string;
  createTypeDirs?: boolean;
  createReadme?: boolean;
}

export interface InitWorkspaceResult {
  workspacePath: string;
  configPath: string;
  config: WorkgraphWorkspaceConfig;
  createdDirectories: string[];
  seededTypes: string[];
}

export function workspaceConfigPath(workspacePath: string): string {
  return path.join(workspacePath, WORKGRAPH_CONFIG_FILE);
}

export function isWorkgraphWorkspace(workspacePath: string): boolean {
  return fs.existsSync(workspaceConfigPath(workspacePath));
}

export function initWorkspace(targetPath: string, options: InitWorkspaceOptions = {}): InitWorkspaceResult {
  const resolvedPath = path.resolve(targetPath);
  const configPath = workspaceConfigPath(resolvedPath);
  if (fs.existsSync(configPath)) {
    throw new Error(`Workgraph workspace already initialized at ${resolvedPath}`);
  }

  const createdDirectories: string[] = [];
  ensureDir(resolvedPath, createdDirectories);
  ensureDir(path.join(resolvedPath, '.clawvault'), createdDirectories);

  const registry = loadRegistry(resolvedPath);
  saveRegistry(resolvedPath, registry);

  if (options.createTypeDirs !== false) {
    const types = listTypes(resolvedPath);
    for (const typeDef of types) {
      ensureDir(path.join(resolvedPath, typeDef.directory), createdDirectories);
    }
  }

  const now = new Date().toISOString();
  const config: WorkgraphWorkspaceConfig = {
    name: options.name ?? path.basename(resolvedPath),
    version: '1.0.0',
    mode: 'workgraph',
    createdAt: now,
    updatedAt: now,
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  if (options.createReadme !== false) {
    writeReadmeIfMissing(resolvedPath, config.name);
  }

  return {
    workspacePath: resolvedPath,
    configPath,
    config,
    createdDirectories,
    seededTypes: listTypes(resolvedPath).map(t => t.name),
  };
}

function ensureDir(dirPath: string, createdDirectories: string[]): void {
  if (fs.existsSync(dirPath)) return;
  fs.mkdirSync(dirPath, { recursive: true });
  createdDirectories.push(dirPath);
}

function writeReadmeIfMissing(workspacePath: string, name: string): void {
  const readmePath = path.join(workspacePath, 'README.md');
  if (fs.existsSync(readmePath)) return;
  const content = `# ${name}

Agent-first workgraph workspace for multi-agent coordination.

## Quickstart

\`\`\`bash
workgraph thread list --json
workgraph thread next --claim --actor agent-a --json
workgraph ledger show --count 20 --json
\`\`\`
`;
  fs.writeFileSync(readmePath, content, 'utf-8');
}
