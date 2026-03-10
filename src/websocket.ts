// WebSocket client wrapper with async message queue and error propagation.
// Wraps the `ws` library for use during Shiny session playback.

import WebSocket from "ws";
import { canIgnore } from "./sockjs.js";
import { RECEIVE_QUEUE_SIZE } from "./types.js";

// ---------------------------------------------------------------------------
// AsyncQueue
// ---------------------------------------------------------------------------

interface Waiter<T> {
  resolve: (value: T | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Bounded async queue with FIFO ordering.
 * Supports async consumers waiting for items via `poll()`.
 */
export class AsyncQueue<T> {
  private readonly capacity: number;
  private readonly items: T[] = [];
  private readonly waiters: Waiter<T>[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /**
   * Add an item to the queue. If a waiter is pending, resolve it immediately.
   * Returns false if the queue is full (no waiter available and at capacity).
   */
  offer(item: T): boolean {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(item);
      return true;
    }
    if (this.items.length >= this.capacity) {
      return false;
    }
    this.items.push(item);
    return true;
  }

  /**
   * Wait for an item with a timeout. Returns the item or null on timeout.
   */
  poll(timeoutMs: number, signal?: AbortSignal): Promise<T | null> {
    const item = this.items.shift();
    if (item !== undefined) {
      return Promise.resolve(item);
    }

    return new Promise<T | null>((resolve) => {
      if (signal?.aborted) {
        resolve(null);
        return;
      }

      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) {
          this.waiters.splice(idx, 1);
        }
        resolve(null);
      }, timeoutMs);

      const waiter: Waiter<T> = { resolve, timer };

      const onAbort = () => {
        clearTimeout(timer);
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) {
          this.waiters.splice(idx, 1);
        }
        resolve(null);
      };

      signal?.addEventListener("abort", onAbort, { once: true });

      const originalResolve = resolve;
      waiter.resolve = (value) => {
        signal?.removeEventListener("abort", onAbort);
        originalResolve(value);
      };

      this.waiters.push(waiter);
    });
  }

  /** Current number of buffered items. */
  get size(): number {
    return this.items.length;
  }
}

// ---------------------------------------------------------------------------
// WSMessage
// ---------------------------------------------------------------------------

export type WSMessage =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "error"; readonly error: Error };

// ---------------------------------------------------------------------------
// ShinyWebSocket
// ---------------------------------------------------------------------------

const POLL_TIMEOUT_MS = 30_000;

export class ShinyWebSocket {
  readonly receiveQueue: AsyncQueue<WSMessage>;
  private readonly ws: WebSocket;
  private _closedByServer = false;
  private _closedByClient = false;
  private _terminalError: Error | null = null;
  private failureCallback: ((error: Error) => void) | null = null;

  constructor(options: {
    url: string;
    headers: Record<string, string>;
    onIgnored?: (msg: string) => void;
  }) {
    this.receiveQueue = new AsyncQueue<WSMessage>(RECEIVE_QUEUE_SIZE);

    this.ws = new WebSocket(options.url, {
      headers: options.headers,
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      const msg = data.toString();

      if (canIgnore(msg)) {
        options.onIgnored?.(msg);
        return;
      }

      if (!this.receiveQueue.offer({ kind: "text", text: msg })) {
        const err = new Error(
          `Message queue is full (max = ${RECEIVE_QUEUE_SIZE}). ` +
            "This is likely a bug; please file a GitHub issue.",
        );
        this.triggerFailure(err);
      }
    });

    this.ws.on("error", (err: Error) => {
      this.triggerFailure(err);
    });

    this.ws.on("close", (_code: number, _reason: Buffer) => {
      if (!this._closedByClient) {
        this._closedByServer = true;
        this.triggerFailure(new Error("Server closed websocket connection"));
      }
    });
  }

  /**
   * Wait for a non-ignorable message. Polls the queue with 30s timeout,
   * calling warnFn each time a timeout occurs. Throws if an error message
   * is received.
   */
  async receive(warnFn: (elapsedSeconds: number) => void, signal?: AbortSignal): Promise<string> {
    let elapsed = POLL_TIMEOUT_MS / 1000;

    while (true) {
      if (this._terminalError) {
        throw this._terminalError;
      }

      if (signal?.aborted) throw signal.reason ?? new Error("Aborted");

      const msg = await this.receiveQueue.poll(POLL_TIMEOUT_MS, signal);

      if (msg === null) {
        if (this._terminalError) {
          throw this._terminalError;
        }
        if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
        warnFn(elapsed);
        elapsed += POLL_TIMEOUT_MS / 1000;
        continue;
      }

      if (msg.kind === "error") {
        throw msg.error;
      }

      return msg.text;
    }
  }

  /** Send a text message over the WebSocket. */
  send(text: string): void {
    this.ws.send(text);
  }

  /** Close the WebSocket connection (client-initiated). */
  close(): void {
    this._closedByClient = true;
    this.ws.close();
  }

  /** Whether the connection was closed by the server. */
  get closedByServer(): boolean {
    return this._closedByServer;
  }

  /** Set a failure callback invoked on error or server-initiated close. */
  onFailure(callback: (error: Error) => void): void {
    this.failureCallback = callback;
  }

  private triggerFailure(error: Error): void {
    this._terminalError = error;
    // Push error into the queue so receive() can throw it
    this.receiveQueue.offer({ kind: "error", error });
    this.failureCallback?.(error);
  }
}
