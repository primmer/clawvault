import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObserverService, createObserverService } from '../src/services/observer.js';
import type { MemoryProvider } from '../src/provider/index.js';
import type { Message, Logger } from '../src/types.js';

function createMockProvider(): MemoryProvider {
  return {
    ingest: vi.fn().mockResolvedValue({
      documentsCreated: 1,
      preferencesExtracted: 0,
      datesIndexed: 0,
      sessionId: 'test',
    }),
    search: vi.fn().mockResolvedValue([]),
    getPreferences: vi.fn().mockResolvedValue([]),
    getDates: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue({
      initialized: true,
      documentCount: 0,
      categories: {},
      preferencesCount: 0,
      datesIndexedCount: 0,
    }),
  };
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('ObserverService', () => {
  let service: ObserverService;
  let mockProvider: MemoryProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    mockProvider = createMockProvider();
    mockLogger = createMockLogger();
    
    service = new ObserverService({
      provider: mockProvider,
      config: { observer: { enabled: true } },
      logger: mockLogger,
    });
  });

  afterEach(async () => {
    await service.stop();
  });

  describe('lifecycle', () => {
    it('should start and stop cleanly', async () => {
      await service.start();
      expect(mockLogger.info).toHaveBeenCalledWith({}, 'ClawVault observer service started');

      await service.stop();
      expect(mockLogger.info).toHaveBeenCalledWith({}, 'ClawVault observer service stopped');
    });

    it('should not start twice', async () => {
      await service.start();
      await service.start();

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      await service.start();
    });

    it('should buffer messages', async () => {
      const message: Message = {
        role: 'user',
        content: 'Hello world',
      };

      await service.onMessageReceived('session-1', message);

      expect(mockProvider.ingest).not.toHaveBeenCalled();
    });

    it('should flush when buffer reaches max size', async () => {
      const messages: Message[] = Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
      }));

      for (const msg of messages) {
        await service.onMessageReceived('session-1', msg);
      }

      expect(mockProvider.ingest).toHaveBeenCalled();
    });

    it('should handle batch messages', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
      ];

      await service.onMessagesReceived('session-1', messages);

      expect(mockProvider.ingest).not.toHaveBeenCalled();
    });

    it('should flush specific session', async () => {
      const message: Message = {
        role: 'user',
        content: 'Test message',
      };

      await service.onMessageReceived('session-1', message);
      await service.flushSession('session-1');

      expect(mockProvider.ingest).toHaveBeenCalledWith(
        'session-1',
        expect.any(Array),
        expect.any(Date)
      );
    });
  });

  describe('disabled observer', () => {
    beforeEach(async () => {
      service = new ObserverService({
        provider: mockProvider,
        config: { observer: { enabled: false } },
        logger: mockLogger,
      });
      await service.start();
    });

    it('should not process messages when disabled', async () => {
      const message: Message = {
        role: 'user',
        content: 'Hello',
      };

      await service.onMessageReceived('session-1', message);
      await service.flushSession('session-1');

      expect(mockProvider.ingest).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      (mockProvider.ingest as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Ingest failed')
      );
      await service.start();
    });

    it('should log errors and continue', async () => {
      const message: Message = {
        role: 'user',
        content: 'Test',
      };

      await service.onMessageReceived('session-1', message);
      await service.flushSession('session-1');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});

describe('createObserverService', () => {
  it('should create an ObserverService instance', () => {
    const mockProvider = createMockProvider();
    const service = createObserverService({ provider: mockProvider });

    expect(service.id).toBe('clawvault-observer');
    expect(service.start).toBeDefined();
    expect(service.stop).toBeDefined();
  });
});
