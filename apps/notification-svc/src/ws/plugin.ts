import fastifyWebsocket from "@fastify/websocket";
import { type SessionStore, parseSessionCookie } from "@lw-idp/auth";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { TokenBucket } from "../backpressure.js";
import { connectionsGauge, ensureNotificationMetricsRegistered } from "../metrics.js";
import type { ConnectionRegistry } from "../registry.js";

export interface WsPluginOptions {
  sessionStore: SessionStore;
  registry: ConnectionRegistry;
  rateLimitPerSec: number;
  rateLimitBurst: number;
  /** Path the WS route is mounted on (default "/ws/stream"). */
  path?: string;
  /** Heartbeat ping interval in ms (default 30_000). 0 disables. */
  pingIntervalMs?: number;
}

const wsPluginFn: FastifyPluginAsync<WsPluginOptions> = async (
  fastify: FastifyInstance,
  opts: WsPluginOptions,
) => {
  // Re-attach our metrics in case fastify-metrics' clearRegisterOnInit wiped them.
  ensureNotificationMetricsRegistered();

  await fastify.register(fastifyWebsocket);

  const path = opts.path ?? "/ws/stream";
  const pingMs = opts.pingIntervalMs ?? 30_000;

  fastify.get(path, { websocket: true }, async (socket, req) => {
    // Cookie-based auth — read from raw request headers (Fastify exposes headers
    // on `req` even for WS upgrades).
    const sid = parseSessionCookie(req.headers.cookie ?? undefined);
    if (!sid) {
      // 4401 — custom application auth-required code (ws spec uses <4000 for protocol).
      socket.close(4401, "unauthorized");
      return;
    }

    const session = await opts.sessionStore.get(sid);
    if (!session) {
      socket.close(4401, "unauthorized");
      return;
    }

    const bucket = new TokenBucket({
      perSec: opts.rateLimitPerSec,
      burst: opts.rateLimitBurst,
    });

    const conn = opts.registry.add(session, bucket, (frameJson) => {
      // Caller (consumer wiring) is expected to call this — it sends to the
      // underlying WS. We tolerate already-closed sockets silently.
      try {
        if (socket.readyState === socket.OPEN) {
          socket.send(frameJson);
        }
      } catch (err) {
        fastify.log.warn({ err, connId: conn.id }, "ws send failed");
      }
    });
    connectionsGauge.inc();

    // Welcome frame so the client knows it is authenticated and which user it is.
    try {
      socket.send(
        JSON.stringify({
          type: "welcome",
          userId: session.userId,
          connectionId: conn.id,
          ts: new Date().toISOString(),
        }),
      );
    } catch (err) {
      fastify.log.warn({ err }, "ws welcome send failed");
    }

    // Heartbeat ping
    const pingTimer =
      pingMs > 0
        ? setInterval(() => {
            try {
              socket.ping();
            } catch {
              // ignore
            }
          }, pingMs)
        : undefined;
    if (pingTimer) {
      pingTimer.unref?.();
    }

    socket.on("close", () => {
      if (pingTimer) {
        clearInterval(pingTimer);
      }
      opts.registry.remove(conn.id);
      connectionsGauge.dec();
    });
  });
};

export const wsPlugin = fp(wsPluginFn, { name: "lw-idp-notification-ws" });
