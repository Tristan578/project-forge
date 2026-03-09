// Async Channel Router — main-thread-side request dispatcher.
// Routes async requests from the script worker to registered channel handlers.

import type { AsyncChannel, AsyncRequest, AsyncResponse, ChannelConfig } from './asyncTypes';
import { CHANNEL_CONFIGS, CHANNEL_ALLOWED_METHODS } from './asyncTypes';

export type AsyncHandler = (
  method: string,
  args: Record<string, unknown>,
  reportProgress: (percent: number, message?: string) => void,
  signal: AbortSignal,
) => Promise<unknown>;

interface ChannelState {
  config: ChannelConfig;
  handler: AsyncHandler;
  activeCount: number;
}

export class AsyncChannelRouter {
  private channels = new Map<string, ChannelState>();
  private pendingResponses: AsyncResponse[] = [];
  private _isPlayMode = false;
  private activeAbortControllers = new Set<AbortController>();

  /**
   * Register a handler for an async channel.
   */
  register(channel: AsyncChannel, handler: AsyncHandler): void {
    const config = CHANNEL_CONFIGS[channel];
    this.channels.set(channel, { config, handler, activeCount: 0 });
  }

  /**
   * Set whether the engine is currently in play mode.
   */
  setPlayMode(isPlay: boolean): void {
    this._isPlayMode = isPlay;
  }

  get isPlayMode(): boolean {
    return this._isPlayMode;
  }

  /**
   * Handle an incoming async request from the worker.
   * Validates channel, method, concurrency, and play-mode constraints.
   * Dispatches to the registered handler asynchronously.
   */
  async handleRequest(request: AsyncRequest): Promise<void> {
    const { requestId, channel, method } = request;

    // Validate channel exists
    const state = this.channels.get(channel);
    if (!state) {
      this.pendingResponses.push({
        requestId,
        status: 'error',
        error: `[${requestId}] Unknown async channel: '${channel}'`,
      });
      return;
    }

    // Validate method is allowed
    const allowedMethods = CHANNEL_ALLOWED_METHODS[channel as AsyncChannel];
    if (!allowedMethods || !allowedMethods.has(method)) {
      this.pendingResponses.push({
        requestId,
        status: 'error',
        error: `[${requestId}] Method '${method}' not allowed on channel '${channel}'`,
      });
      return;
    }

    // Check play-mode constraint
    if (state.config.playModeOnly && !this._isPlayMode) {
      this.pendingResponses.push({
        requestId,
        status: 'error',
        error: `[${requestId}] Channel '${channel}' requires play mode`,
      });
      return;
    }

    // Check concurrency limit
    if (state.activeCount >= state.config.maxConcurrent) {
      this.pendingResponses.push({
        requestId,
        status: 'error',
        error: `[${requestId}] Channel '${channel}' at max concurrency (${state.config.maxConcurrent})`,
      });
      return;
    }

    // Dispatch to handler
    state.activeCount++;

    const abortController = new AbortController();
    this.activeAbortControllers.add(abortController);

    const reportProgress = (percent: number, message?: string) => {
      if (state.config.supportsProgress) {
        this.pendingResponses.push({
          requestId,
          status: 'progress',
          progress: { percent, message },
        });
      }
    };

    // Enforce per-channel timeout from CHANNEL_CONFIGS
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, state.config.timeoutMs);

    try {
      const args = (request.args ?? {}) as Record<string, unknown>;
      const data = await state.handler(method, args, reportProgress, abortController.signal);
      this.pendingResponses.push({
        requestId,
        status: 'ok',
        data,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // Only log non-abort errors (aborts are expected during cleanup)
      if (!abortController.signal.aborted) {
        console.error(`[forge:async:${channel}] ${method} handler error (${requestId}):`, err);
      }
      this.pendingResponses.push({
        requestId,
        status: 'error',
        error: `[${requestId}] ${abortController.signal.aborted ? 'Request timed out or was cancelled' : errorMessage}`,
      });
    } finally {
      clearTimeout(timeoutId);
      this.activeAbortControllers.delete(abortController);
      state.activeCount--;
    }
  }

  /**
   * Drain all pending responses. Returns the responses array, or undefined if empty.
   * Used by the tick loop to batch responses to the worker.
   */
  flush(): AsyncResponse[] | undefined {
    if (this.pendingResponses.length === 0) return undefined;
    const responses = this.pendingResponses;
    this.pendingResponses = [];
    return responses;
  }

  /**
   * Get the current active request count for a channel.
   */
  getActiveCount(channel: AsyncChannel): number {
    return this.channels.get(channel)?.activeCount ?? 0;
  }

  /**
   * Reset all state (used when stopping play mode).
   */
  reset(): void {
    // Abort all in-flight async operations (cancels polling loops, fetch requests, etc.)
    for (const controller of this.activeAbortControllers) {
      controller.abort();
    }
    this.activeAbortControllers.clear();
    for (const state of this.channels.values()) {
      state.activeCount = 0;
    }
    this.pendingResponses = [];
    this._isPlayMode = false;
  }
}
