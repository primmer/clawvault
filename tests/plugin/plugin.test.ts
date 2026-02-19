import { describe, it, expect, beforeEach, vi } from 'vitest';
import clawvaultPlugin, { getTemplateRegistry } from '../../src/plugin/index.js';
import type { ToolSchema, Service, SlashCommand } from '../../src/plugin/types.js';

// Mock file system for vault detection
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (path.includes('.clawvault.json')) return true;
      return false;
    }),
    readFileSync: vi.fn((path: string) => {
      if (path.includes('.clawvault.json')) {
        return JSON.stringify({ name: 'test-vault' });
      }
      return '';
    }),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
  };
});

function createMockApi(): {
  pluginConfig: any;
  logger: any;
  registerTool: ReturnType<typeof vi.fn>;
  registerService: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  registerCli: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  registeredTools: Map<string, { name: string; execute: Function }>;
  registeredServices: Service[];
  registeredCommands: SlashCommand[];
  registeredHooks: Map<string, Function>;
} {
  const registeredTools = new Map<string, { name: string; execute: Function }>();
  const registeredServices: Service[] = [];
  const registeredCommands: SlashCommand[] = [];
  const registeredHooks = new Map<string, Function>();

  return {
    pluginConfig: {
      vaultPath: '/tmp/test-vault-' + Date.now(),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    registerTool: vi.fn((tool: any) => {
      registeredTools.set(tool.name, tool);
    }),
    registerService: vi.fn((service: any) => {
      registeredServices.push(service);
    }),
    registerCommand: vi.fn((command: any) => {
      registeredCommands.push(command);
    }),
    registerCli: vi.fn(),
    on: vi.fn((hookName: string, handler: Function) => {
      registeredHooks.set(hookName, handler);
    }),
    registeredTools,
    registeredServices,
    registeredCommands,
    registeredHooks,
  };
}

describe('ClawVault OpenClaw Plugin', () => {
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockApi = createMockApi();
  });

  describe('registration', () => {
    it('should register all tools', () => {
      clawvaultPlugin.register(mockApi);

      // New plugin registers 4 tools: memory_search, memory_get, memory_store, memory_forget
      expect(mockApi.registerTool).toHaveBeenCalledTimes(4);
      expect(mockApi.registeredTools.has('memory_search')).toBe(true);
      expect(mockApi.registeredTools.has('memory_get')).toBe(true);
      expect(mockApi.registeredTools.has('memory_store')).toBe(true);
      expect(mockApi.registeredTools.has('memory_forget')).toBe(true);
    });

    it('should register service', () => {
      clawvaultPlugin.register(mockApi);

      expect(mockApi.registerService).toHaveBeenCalledTimes(1);
      expect(mockApi.registeredServices[0].id).toBe('clawvault');
    });

    it('should register /vault command', () => {
      clawvaultPlugin.register(mockApi);

      expect(mockApi.registerCommand).toHaveBeenCalledTimes(1);
      expect(mockApi.registeredCommands[0].name).toBe('vault');
    });

    it('should register hooks for auto-recall and auto-capture', () => {
      clawvaultPlugin.register(mockApi);

      // Should register before_agent_start, message_received, agent_end, before_compaction
      expect(mockApi.on).toHaveBeenCalledWith('before_agent_start', expect.any(Function), expect.any(Object));
      expect(mockApi.on).toHaveBeenCalledWith('message_received', expect.any(Function));
      expect(mockApi.on).toHaveBeenCalledWith('agent_end', expect.any(Function));
      expect(mockApi.on).toHaveBeenCalledWith('before_compaction', expect.any(Function));
    });

    it('should log initialization', () => {
      clawvaultPlugin.register(mockApi);

      expect(mockApi.logger.info).toHaveBeenCalled();
    });
  });

  describe('plugin metadata', () => {
    it('should have correct id', () => {
      expect(clawvaultPlugin.id).toBe('clawvault');
    });

    it('should have correct version', () => {
      expect(clawvaultPlugin.version).toBe('3.1.0');
    });

    it('should have correct kind', () => {
      expect(clawvaultPlugin.kind).toBe('memory');
    });
  });

  describe('tool schemas', () => {
    beforeEach(() => {
      clawvaultPlugin.register(mockApi);
    });

    it('memory_search should have correct schema', () => {
      const tool = mockApi.registeredTools.get('memory_search');
      expect(tool?.name).toBe('memory_search');
    });

    it('memory_get should have correct schema', () => {
      const tool = mockApi.registeredTools.get('memory_get');
      expect(tool?.name).toBe('memory_get');
    });

    it('memory_store should have correct schema', () => {
      const tool = mockApi.registeredTools.get('memory_store');
      expect(tool?.name).toBe('memory_store');
    });

    it('memory_forget should have correct schema', () => {
      const tool = mockApi.registeredTools.get('memory_forget');
      expect(tool?.name).toBe('memory_forget');
    });
  });

  describe('/vault command', () => {
    beforeEach(() => {
      clawvaultPlugin.register(mockApi);
    });

    it('should handle status subcommand', () => {
      const command = mockApi.registeredCommands[0];
      const result = command.handler({ args: 'status' });

      expect(result.text).toContain('ClawVault');
    });

    it('should handle templates subcommand', () => {
      const command = mockApi.registeredCommands[0];
      const result = command.handler({ args: 'templates' });

      expect(result.text).toContain('Template schemas');
    });

    it('should default to status for empty args', () => {
      const command = mockApi.registeredCommands[0];
      const result = command.handler({ args: '' });

      expect(result.text).toContain('ClawVault');
    });

    it('should show usage for unknown subcommand', () => {
      const command = mockApi.registeredCommands[0];
      const result = command.handler({ args: 'unknown' });

      expect(result.text).toContain('Usage:');
    });
  });

  describe('template registry', () => {
    it('should initialize template registry on boot', () => {
      clawvaultPlugin.register(mockApi);

      const registry = getTemplateRegistry();
      expect(registry).toBeDefined();
      expect(registry?.initialized).toBe(true);
    });

    it('should have default schemas when templates directory is missing', () => {
      clawvaultPlugin.register(mockApi);

      const registry = getTemplateRegistry();
      expect(registry?.schemas.size).toBeGreaterThan(0);
    });
  });

  describe('config resolution', () => {
    it('should use vaultPath from config', () => {
      const customPath = '/custom/vault/path';
      mockApi.pluginConfig = { vaultPath: customPath };

      clawvaultPlugin.register(mockApi);

      expect(mockApi.logger.info).toHaveBeenCalled();
    });

    it('should handle missing config gracefully', () => {
      mockApi.pluginConfig = undefined;

      expect(() => clawvaultPlugin.register(mockApi)).not.toThrow();
    });

    it('should handle empty config gracefully', () => {
      mockApi.pluginConfig = {};

      expect(() => clawvaultPlugin.register(mockApi)).not.toThrow();
    });
  });

  describe('auto-recall disabled', () => {
    it('should not register before_agent_start hook when autoRecall is false', () => {
      mockApi.pluginConfig = { autoRecall: false };

      clawvaultPlugin.register(mockApi);

      const beforeAgentStartCalls = (mockApi.on as any).mock.calls.filter(
        (call: any[]) => call[0] === 'before_agent_start'
      );
      expect(beforeAgentStartCalls.length).toBe(0);
    });
  });

  describe('auto-capture disabled', () => {
    it('should not register message_received hook when autoCapture is false', () => {
      mockApi.pluginConfig = { autoCapture: false };

      clawvaultPlugin.register(mockApi);

      const messageReceivedCalls = (mockApi.on as any).mock.calls.filter(
        (call: any[]) => call[0] === 'message_received'
      );
      expect(messageReceivedCalls.length).toBe(0);
    });
  });
});
