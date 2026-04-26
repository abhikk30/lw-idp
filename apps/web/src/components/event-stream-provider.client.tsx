"use client";

import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef } from "react";
import { toast } from "sonner";
import { humanizeFrame, invalidationKeysFor } from "../lib/events/invalidation-map.js";

/**
 * 4xxx WebSocket close codes are application-class and treated as terminal —
 * notification-svc emits 4401 when the user's session has expired. There is
 * no point reconnecting because the next connect will be rejected the same
 * way; instead we surface a "session expired" toast prompting reload.
 *
 * Standard 1xxx codes (1000 normal, 1001 going away, 1006 abnormal) still
 * trigger backoff reconnect — those are network-level events that should
 * recover.
 */
function isTerminalCloseCode(code: number): boolean {
  return code >= 4000 && code < 5000;
}

export interface EventStreamProviderProps {
  /** WS URL (default: same-origin /ws/stream). Override for tests. */
  url?: string;
  /** Children (the rest of the app). */
  children: ReactNode;
  /** Reconnect backoff ms cap (default 30s). 0 disables reconnect. */
  reconnectMaxMs?: number;
}

interface InboundFrame {
  type: string;
  entity?: string;
  action?: string;
  payload?: Record<string, unknown>;
  ts?: string;
  userId?: string;
  connectionId?: number;
  id?: string;
}

/**
 * Opens a WebSocket to /ws/stream (or `url` for tests), translates each
 * inbound frame into TanStack Query invalidations + a sonner toast, and
 * reconnects with bounded exponential backoff on close/error.
 *
 * Mounts INSIDE the QueryClientProvider so useQueryClient resolves.
 */
export function EventStreamProvider({
  url,
  children,
  reconnectMaxMs = 30_000,
}: EventStreamProviderProps): ReactNode {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | undefined>(undefined);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    let backoffMs = 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let terminalToastShown = false;

    const connect = (): void => {
      if (stoppedRef.current) {
        return;
      }
      const wsUrl =
        url ??
        (typeof window !== "undefined"
          ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/stream`
          : "ws://localhost/ws/stream");
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        console.warn("[event-stream] WS construct failed", err);
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        backoffMs = 1_000; // reset backoff on successful connect
      });

      ws.addEventListener("message", (ev: MessageEvent) => {
        let frame: InboundFrame;
        try {
          frame = JSON.parse(typeof ev.data === "string" ? ev.data : "") as InboundFrame;
        } catch {
          return; // ignore malformed
        }
        if (frame.type === "welcome") {
          return; // skip handshake frame
        }
        const entity = frame.entity ?? "";
        const action = frame.action ?? "";
        if (!entity || !action) {
          return;
        }
        const keys = invalidationKeysFor(entity, action);
        for (const key of keys) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
        toast(humanizeFrame(entity, action, frame.payload));
      });

      ws.addEventListener("close", (ev: CloseEvent) => {
        if (isTerminalCloseCode(ev.code)) {
          stoppedRef.current = true;
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          if (!terminalToastShown) {
            terminalToastShown = true;
            toast.error("Session expired", {
              description: "Reload the page to sign in again.",
              action: {
                label: "Reload",
                onClick: () => window.location.reload(),
              },
            });
          }
          return;
        }
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        // close handler will fire too; only schedule once.
        try {
          ws.close();
        } catch {
          // ignore
        }
      });
    };

    const scheduleReconnect = (): void => {
      if (stoppedRef.current || reconnectMaxMs === 0) {
        return;
      }
      timer = setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, reconnectMaxMs);
    };

    connect();

    return () => {
      stoppedRef.current = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
    };
    // url + reconnectMaxMs are stable per render; queryClient is stable from provider
  }, [url, reconnectMaxMs, queryClient]);

  return <>{children}</>;
}
