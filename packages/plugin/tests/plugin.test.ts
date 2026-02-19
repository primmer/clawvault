import { describe, it, expect, beforeEach, vi } from 'vitest';
import registerClawVaultPlugin, { getProvider, getObserverService } from '../src/index.js';
import type { OpenClawApi, ToolSchema, Service, SlashCommand } from '../src/types.js';

function createMockApi(): OpenClawApi & {
  registeredTools: Map<string, { schema: ToolSchema; handler: Function }>;
  registeredServices: Service[];
  registeredCommands: SlashCommand[];
  registeredHooks: Map<string, Function>;
} {
  const registeredTools = new Map<string, { schema: ToolSchema; handler: Function }>();
  const registeredServices: Service[] = [];
  const registeredCommands: SlashCommand[] = [];
  const registeredHooks = new Map<string, Function>();

  return {
    config: {
      plugins: {
        clawvault: {
          vaultPath: '/tmp/test-vault-' + Date.now(),
          observer: { enabled: true },
          search: { defaultLimit: 10 },
        },
      },
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    registerTool: vi.fn((name, schema, handler) => {
      registeredTools.set(name, { schema, handler });
    }),
    registerService: vi.fn((service) => {
      registeredServices.push(service);
    }),
    registerCommand: vi.fn((command) => {
      registeredCommands.push(command);
    }),
    registerHook: vi.fn((hookName, handler) => {
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
      registerClawVaultPlugin(mockApi);

      expect(mockApi.registerTool).toHaveBeenCalledTimes(3);
      expect(mockApi.registeredTools.has('memory_search')).toBe(true);
      expect(mockApi.registeredTools.has('vault_status')).toBe(true);
      expect(mockApi.registeredTools.has('vault_preferences')).toBe(true);
    });

    it('should register observer service', () => {
      registerClawVaultPlugin(mockApi);

      expect(mockApi.registerService).toHaveBeenCalledTimes(1);
      expect(mockApi.registeredServices[0].id).toBe('clawvault-observer');
    });

    it('should register /vault command', () => {
      registerClawVaultPlugin(mockApi);

      expect(mockApi.registerCommand).toHaveBeenCalledTimes(1);
      expect(mockApi.registeredCommands[0].name).toBe('/vault');
    });

    it('should register message_received hook', () => {
      registerClawVaultPlugin(mockApi);

      expect(mockApi.registerHook).toHaveBeenCalledWith('message_received', expect.any(Function));
    });

    it('should log initialization', () => {
      registerClawVaultPlugin(mockApi);

      expect(mockApi.logger?.info).toHaveBeenCalledWith(
        expect.objectContaining({ vaultPath: expect.any(String) }),
        'ClawVault memory plugin initialized'
      );
    });
  });

  describe('tool schemas', () => {
    beforeEach(() => {
      registerClawVaultPlugin(mockApi);
    });

    it('memory_search should have correct schema', () => {
      const tool = mockApi.registeredTools.get('memory_search');
      expect(tool?.schema.name).toBe('memory_search');
      expect(tool?.schema.parameters.properties.query).toBeDefined();
      expect(tool?.schema.parameters.required).toContain('query');
    });

    it('vault_status should have correct schema', () => {
      const tool = mockApi.registeredTools.get('vault_status');
      expect(tool?.schema.name).toBe('vault_status');
    });

    it('vault_preferences should have correct schema', () => {
      const tool = mockApi.registeredTools.get('vault_preferences');
      expect(tool?.schema.name).toBe('vault_preferences');
      expect(tool?.schema.parameters.properties.category).toBeDefined();
    });
  });

  describe('/vault command', () => {
    beforeEach(() => {
      registerClawVaultPlugin(mockApi);
    });

    it('should handle help subcommand', async () => {
      const command = mockApi.registeredCommands[0];
      const result = await command.handler({ args: 'help' });

      expect(result.content).toContain('ClawVault Commands');
      expect(result.content).toContain('/vault status');
      expect(result.content).toContain('/vault search');
    });

    it('should handle status subcommand', async () => {
      const command = mockApi.registeredCommands[0];
      const result = await command.handler({ args: 'status' });

      expect(result.content).toContain('ClawVault Status');
    });

    it('should handle search subcommand without query', async () => {
      const command = mockApi.registeredCommands[0];
      const result = await command.handler({ args: 'search' });

      expect(result.content).toContain('Usage:');
    });

    it('should handle preferences subcommand', async () => {
      const command = mockApi.registeredCommands[0];
      const result = await command.handler({ args: 'preferences' });

      expect(result.content).toBeDefined();
    });

    it('should handle dates subcommand', async () => {
      const command = mockApi.registeredCommands[0];
      const result = await command.handler({ args: 'dates' });

      expect(result.content).toBeDefined();
    });

    it('should default to help for unknown subcommand', async () => {
      const command = mockApi.registeredCommands[0];
      const result = await command.handler({ args: 'unknown' });

      expect(result.content).toContain('ClawVault Commands');
    });
  });

  describe('provider access', () => {
    it('should expose provider instance', () => {
      registerClawVaultPlugin(mockApi);

      const provider = getProvider();
      expect(provider).toBeDefined();
    });

    it('should expose observer service', () => {
      registerClawVaultPlugin(mockApi);

      const observer = getObserverService();
      expect(observer).toBeDefined();
    });
  });

  describe('config resolution', () => {
    it('should use vaultPath from config', () => {
      const customPath = '/custom/vault/path';
      mockApi.config = {
        plugins: {
          clawvault: {
            vaultPath: customPath,
          },
        },
      };

      registerClawVaultPlugin(mockApi);

      expect(mockApi.logger?.info).toHaveBeenCalledWith(
        expect.objectContaining({ vaultPath: customPath }),
        expect.any(String)
      );
    });

    it('should handle missing config gracefully', () => {
      mockApi.config = undefined;

      expect(() => registerClawVaultPlugin(mockApi)).not.toThrow();
    });

    it('should handle empty config gracefully', () => {
      mockApi.config = {};

      expect(() => registerClawVaultPlugin(mockApi)).not.toThrow();
    });
  });
});
