import fastifyCookie from "@fastify/cookie";
import {
  type SessionRecord,
  type SessionStore,
  parseSessionCookie,
  sessionCookieName,
} from "@lw-idp/auth";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionRecord;
  }
}

export interface SessionPluginOptions {
  store: SessionStore;
  /** Paths under these prefixes skip session enforcement (cookie still parsed if present). */
  publicPrefixes?: string[];
}

const DEFAULT_PUBLIC: string[] = ["/healthz", "/readyz", "/metrics", "/auth/"];

async function sessionPluginFn(
  fastify: FastifyInstance,
  opts: SessionPluginOptions,
): Promise<void> {
  await fastify.register(fastifyCookie);

  const publicPrefixes = opts.publicPrefixes ?? DEFAULT_PUBLIC;

  fastify.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    // Attempt to populate req.session from the cookie, regardless of public/private.
    const rawCookie = req.headers.cookie;
    const sid = parseSessionCookie(rawCookie ?? undefined);
    if (sid) {
      const record = await opts.store.get(sid);
      if (record) {
        req.session = record;
      }
    }

    const isPublic = publicPrefixes.some((p) => req.url === p || req.url.startsWith(p));
    if (!isPublic && !req.session) {
      // Return the reply so Fastify short-circuits subsequent preHandler hooks
      // (rate-limit, idempotency). Without the return, unauth requests still
      // consume rate-limit budget and hit Dragonfly for idempotency lookups.
      return reply.code(401).send({ code: "unauthorized", message: "authentication required" });
    }
  });
}

export const sessionPlugin = fp(sessionPluginFn, { name: "lw-idp-session" });
export { sessionCookieName };
