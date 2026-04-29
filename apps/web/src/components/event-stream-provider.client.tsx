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

    // Coalesce rapid bursts of events (e.g. Argo CD selfHeal cycles fire
    // on-sync-running + on-deployed + on-health-degraded in quick succession
    // for each Application). Without batching, each frame triggered an
    // immediate invalidateQueries + toast, which under load (>50 frames in
    // a few seconds) caused render storms that froze the browser after the
    // tab had been idle for a while.
    const pendingKeys = new Map<string, readonly unknown[]>(); // serialized key -> original key
    let flushScheduled = false;
    const lastToastAt = new Map<string, number>(); // (entity:action) -> ms timestamp
    const TOAST_THROTTLE_MS = 1_500;

    const flush = (): void => {
      flushScheduled = false;
      for (const [, key] of pendingKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      pendingKeys.clear();
    };

    const scheduleFlush = (): void => {
      if (flushScheduled) {
        return;
      }
      flushScheduled = true;
      setTimeout(flush, 250);
    };

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
        // Coalesce invalidations: buffer the keys, flush in a single
        // 250ms window. Repeated invalidations for the same key collapse
        // to one refetch.
        for (const key of invalidationKeysFor(entity, action)) {
          pendingKeys.set(JSON.stringify(key), key);
        }
        scheduleFlush();

        // Throttle toasts per (entity, action): one toast every 1.5s max.
        // A reconcile cycle that fires sync-running + deployed back-to-back
        // for the same app emits two toasts; under burst load the second
        // gets dropped, which is fine — the first one already told the user.
        const toastKey = `${entity}:${action}`;
        const now = Date.now();
        const last = lastToastAt.get(toastKey) ?? 0;
        if (now - last >= TOAST_THROTTLE_MS) {
          lastToastAt.set(toastKey, now);
          toast(humanizeFrame(entity, action, frame.payload));
        }
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
