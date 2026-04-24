import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Redis } from "ioredis";

export interface RateLimitPluginOptions {
  redis: Redis;
  max: number;
  timeWindowMs: number;
}

const rateLimitPluginFn: FastifyPluginAsync<RateLimitPluginOptions> = async (fastify, opts) => {
  await fastify.register(rateLimit, {
    max: opts.max,
    timeWindow: opts.timeWindowMs,
    redis: opts.redis,
    // Run in preHandler so that sessionPlugin has already populated req.session
    hook: "preHandler",
    // Per-user when authenticated, per-IP otherwise
    keyGenerator: (req: FastifyRequest) => {
      const session = req.session;
      return session ? `user:${session.userId}` : `ip:${req.ip}`;
    },
    errorResponseBuilder: (_req, context) => {
      // @fastify/rate-limit throws the return value of errorResponseBuilder.
      // It must be an Error with .statusCode so Fastify sends the right HTTP status;
      // extra own-properties are merged into the JSON response body.
      const err = Object.assign(
        new Error(`rate limit exceeded — ${context.max} requests per ${context.after}`),
        {
          statusCode: context.statusCode ?? 429,
          code: "rate_limited",
          details: { max: context.max, resetSeconds: Math.ceil(context.ttl / 1000) },
        },
      );
      return err;
    },
  });
};

export const rateLimitPlugin = fp(rateLimitPluginFn, {
  name: "lw-idp-rate-limit",
  // Register after session plugin so keyGenerator sees req.session
  dependencies: ["lw-idp-session"],
});
