/**
 * Observer Service for OpenClaw
 * 
 * Background service that observes messages and ingests them into memory
 */

import type { Service, Message, PluginConfig, Logger } from '../types.js';
import type { MemoryProvider } from '../provider/index.js';

export interface ObserverServiceOptions {
  provider: MemoryProvider;
  config?: PluginConfig;
  logger?: Logger;
}

interface MessageBuffer {
  sessionId: string;
  messages: Message[];
  lastActivity: Date;
}

export class ObserverService implements Service {
  readonly id = 'clawvault-observer';
  
  private readonly provider: MemoryProvider;
  private readonly config: PluginConfig;
  private readonly logger?: Logger;
  private readonly buffers: Map<string, MessageBuffer> = new Map();
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  private readonly flushIntervalMs = 30000; // 30 seconds
  private readonly maxBufferSize = 50;
  private readonly inactivityThresholdMs = 60000; // 1 minute

  constructor(options: ObserverServiceOptions) {
    this.provider = options.provider;
    this.config = options.config ?? {};
    this.logger = options.logger;
  }

  async start(): Promise<void> {
    if (this.running) return;
    
    this.running = true;
    this.flushInterval = setInterval(() => this.flushInactiveBuffers(), this.flushIntervalMs);
    this.logger?.info?.({}, 'ClawVault observer service started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    await this.flushAllBuffers();
    this.logger?.info?.({}, 'ClawVault observer service stopped');
  }

  /**
   * Handle incoming message event
   * Called by the message_received hook
   */
  async onMessageReceived(sessionId: string, message: Message): Promise<void> {
    if (!this.running || !this.config.observer?.enabled) return;

    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      buffer = {
        sessionId,
        messages: [],
        lastActivity: new Date(),
      };
      this.buffers.set(sessionId, buffer);
    }

    buffer.messages.push(message);
    buffer.lastActivity = new Date();

    if (buffer.messages.length >= this.maxBufferSize) {
      await this.flushBuffer(sessionId);
    }
  }

  /**
   * Handle batch of messages (for bulk processing)
   */
  async onMessagesReceived(sessionId: string, messages: Message[]): Promise<void> {
    if (!this.running || !this.config.observer?.enabled) return;

    for (const message of messages) {
      await this.onMessageReceived(sessionId, message);
    }
  }

  /**
   * Force flush a specific session's buffer
   */
  async flushSession(sessionId: string): Promise<void> {
    await this.flushBuffer(sessionId);
  }

  private async flushBuffer(sessionId: string): Promise<void> {
    const buffer = this.buffers.get(sessionId);
    if (!buffer || buffer.messages.length === 0) return;

    try {
      const result = await this.provider.ingest(
        sessionId,
        buffer.messages,
        buffer.lastActivity
      );
      
      this.logger?.debug?.(
        { session: sessionId, ...result },
        'Flushed message buffer to memory'
      );
      
      buffer.messages = [];
    } catch (error) {
      this.logger?.error?.(
        { sessionId, error: String(error) },
        'Failed to flush message buffer'
      );
    }
  }

  private async flushInactiveBuffers(): Promise<void> {
    const now = Date.now();
    
    for (const [sessionId, buffer] of this.buffers) {
      const inactiveMs = now - buffer.lastActivity.getTime();
      
      if (inactiveMs >= this.inactivityThresholdMs && buffer.messages.length > 0) {
        await this.flushBuffer(sessionId);
      }
    }
  }

  private async flushAllBuffers(): Promise<void> {
    for (const sessionId of this.buffers.keys()) {
      await this.flushBuffer(sessionId);
    }
  }
}

export function createObserverService(options: ObserverServiceOptions): Service {
  return new ObserverService(options);
}
