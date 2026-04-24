import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Redis } from "ioredis";

export interface IdempotencyPluginOptions {
  redis: Redis;
  ttlSeconds: number;
  keyPrefix?: string;
  /** HTTP methods to apply idempotency to. Default: POST, PATCH, DELETE, PUT. */
  methods?: string[];
}

interface StoredResponse {
  status: number;
  body: string;
  contentType: string;
  requestHash: string;
}

const UNSAFE_METHODS = new Set(["POST", "PATCH", "DELETE", "PUT"]);

function hashRequestBody(body: unknown): string {
  if (body === undefined || body === null) {
    return "";
  }
  const s = typeof body === "string" ? body : JSON.stringify(body);
  return createHash("sha256").update(s).digest("base64url").slice(0, 16);
}

const idempotencyPluginFn: FastifyPluginAsync<IdempotencyPluginOptions> = async (fastify, opts) => {
  const prefix = opts.keyPrefix ?? "lw-idp:idem:";
  const ttl = opts.ttlSeconds;
  const methods = new Set((opts.methods ?? [...UNSAFE_METHODS]).map((m) => m.toUpperCase()));

  // preHandler: replay if we've seen this key
  fastify.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!methods.has(req.method)) {
      return;
    }
    const idemKey = req.headers["idempotency-key"];
    if (!idemKey || typeof idemKey !== "string" || idemKey.length > 128) {
      return;
    }
    const userId = req.session?.userId ?? "anon";
    const storeKey = `${prefix}${userId}:${req.method}:${req.url}:${idemKey}`;
    const raw = await opts.redis.get(storeKey);
    if (!raw) {
      return;
    }

    let stored: StoredResponse;
    try {
      stored = JSON.parse(raw) as StoredResponse;
    } catch {
      return;
    }

    // Also verify request body hash matches — protect against different requests reusing the same key
    const currentHash = hashRequestBody(req.body);
    if (stored.requestHash !== currentHash) {
      await reply
        .code(409)
        .send({ code: "conflict", message: "Idempotency-Key reused with different request body" });
      return;
    }

    await reply
      .code(stored.status)
      .header("content-type", stored.contentType)
      .header("idempotency-replayed", "true")
      .send(stored.body);
  });

  // onSend: capture the response on first success so it can be replayed
  fastify.addHook("onSend", async (req, reply, payload) => {
    if (!methods.has(req.method)) {
      return payload;
    }
    const idemKey = req.headers["idempotency-key"];
    if (!idemKey || typeof idemKey !== "string" || idemKey.length > 128) {
      return payload;
    }
    if (reply.getHeader("idempotency-replayed")) {
      return payload; // don't re-store a replay
    }
    if (reply.statusCode >= 500) {
      return payload; // don't cache transient failures
    }
    const userId = req.session?.userId ?? "anon";
    const storeKey = `${prefix}${userId}:${req.method}:${req.url}:${idemKey}`;

    const body =
      typeof payload === "string"
        ? payload
        : payload instanceof Buffer
          ? payload.toString("utf8")
          : "";
    const record: StoredResponse = {
      status: reply.statusCode,
      body,
      contentType: String(reply.getHeader("content-type") ?? "application/json"),
      requestHash: hashRequestBody(req.body),
    };
    await opts.redis.set(storeKey, JSON.stringify(record), "EX", ttl);
    return payload;
  });
};

export const idempotencyPlugin = fp(idempotencyPluginFn, {
  name: "lw-idp-idempotency",
  dependencies: ["lw-idp-session"],
});
