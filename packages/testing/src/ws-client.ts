import WebSocket, { type ClientOptions } from "ws";

export interface WsClientOptions {
  /** e.g. "ws://127.0.0.1:1234/ws/stream" */
  url: string;
  /** Raw Cookie header value, e.g. "lw-sid=sess_01HX…" */
  cookie?: string;
  /** Handshake timeout, default 5000ms. */
  handshakeTimeoutMs?: number;
  /** Additional headers merged with Cookie. */
  headers?: Record<string, string>;
}

export interface WsClient {
  /** Resolves once the WS handshake completes (or rejects on handshake error). */
  opened: Promise<void>;
  /**
   * All messages received, in arrival order. Each entry is the JSON-parsed
   * value when the frame was valid JSON; otherwise the raw string.
   */
  readonly messages: readonly unknown[];
  /**
   * Resolves when a message matching `predicate` arrives, or rejects after
   * `timeoutMs` (default 5000ms). Already-buffered messages are checked at
   * call time so tests can't race past fast arrivals.
   */
  waitFor<T = unknown>(
    predicate: ((msg: unknown) => msg is T) | ((msg: unknown) => boolean),
    timeoutMs?: number,
  ): Promise<T>;
  /** Send a string or a JSON-stringified object. */
  send(data: string | object): void;
  /** Close the connection (code 1000). Idempotent. */
  close(): Promise<void>;
  /** Underlying ws socket for edge cases (e.g. setting a max payload). */
  readonly raw: WebSocket;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;

function parseFrame(data: WebSocket.RawData): unknown {
  const text = typeof data === "string" ? data : data.toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function openWsClient(opts: WsClientOptions): WsClient {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie !== undefined) {
    headers.cookie = opts.cookie;
  }

  const clientOptions: ClientOptions = {
    handshakeTimeout: opts.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
    headers,
  };

  const raw = new WebSocket(opts.url, clientOptions);

  const messages: unknown[] = [];
  const messageListeners: Array<(msg: unknown) => void> = [];

  let opened = false;
  let closed = false;
  let handshakeError: Error | undefined;

  const openedPromise = new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      opened = true;
      cleanup();
      resolve();
    };
    const onError = (err: Error): void => {
      handshakeError = err;
      cleanup();
      reject(err);
    };
    const onUnexpected = (_req: unknown, res: { statusCode?: number }): void => {
      const err = new Error(
        `WebSocket handshake rejected with status ${res.statusCode ?? "unknown"}`,
      );
      handshakeError = err;
      cleanup();
      reject(err);
    };
    const cleanup = (): void => {
      raw.off("open", onOpen);
      raw.off("error", onError);
      raw.off("unexpected-response", onUnexpected);
    };
    raw.on("open", onOpen);
    raw.on("error", onError);
    raw.on("unexpected-response", onUnexpected);
  });

  // Swallow post-handshake 'error' so unhandled rejections don't take down
  // the test process; callers should rely on `close()` or `waitFor` timeouts
  // to observe trouble.
  raw.on("error", () => {
    /* no-op: opened promise owns the first handshake-phase error */
  });

  raw.on("message", (data) => {
    const msg = parseFrame(data);
    messages.push(msg);
    // Copy listeners to avoid mutation-during-iteration issues.
    for (const listener of messageListeners.slice()) {
      listener(msg);
    }
  });

  const closePromise = new Promise<void>((resolve) => {
    raw.on("close", () => {
      closed = true;
      resolve();
    });
  });

  function waitFor<T>(
    predicate: ((msg: unknown) => msg is T) | ((msg: unknown) => boolean),
    timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Check already-buffered messages first so we don't miss fast arrivals.
      for (const existing of messages) {
        if (predicate(existing)) {
          resolve(existing as T);
          return;
        }
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        const idx = messageListeners.indexOf(listener);
        if (idx !== -1) {
          messageListeners.splice(idx, 1);
        }
        reject(new Error(`waitFor timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (msg: unknown): void => {
        if (settled) {
          return;
        }
        if (predicate(msg)) {
          settled = true;
          clearTimeout(timer);
          const idx = messageListeners.indexOf(listener);
          if (idx !== -1) {
            messageListeners.splice(idx, 1);
          }
          resolve(msg as T);
        }
      };
      messageListeners.push(listener);
    });
  }

  function send(data: string | object): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    raw.send(payload);
  }

  async function close(): Promise<void> {
    if (closed) {
      return;
    }
    if (raw.readyState === WebSocket.CLOSED || raw.readyState === WebSocket.CLOSING) {
      await closePromise;
      return;
    }
    try {
      raw.close(1000);
    } catch {
      // If the socket isn't open yet, terminate to avoid a hang.
      raw.terminate();
    }
    await closePromise;
  }

  // Reference these so `noUnusedLocals` is content — they're useful for
  // consumers who want to sanity-check state without poking `raw.readyState`.
  void opened;
  void handshakeError;

  return {
    opened: openedPromise,
    get messages(): readonly unknown[] {
      return messages;
    },
    waitFor,
    send,
    close,
    raw,
  };
}
