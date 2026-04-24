import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { IdentityClient } from "../clients/identity.js";

export interface MePluginOptions {
  identityClient: IdentityClient;
}

const mePluginFn: FastifyPluginAsync<MePluginOptions> = async (fastify, opts) => {
  fastify.get("/api/v1/me", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ code: "unauthorized", message: "authentication required" });
    }
    try {
      const teams = await opts.identityClient.getMyTeams({ userId: req.session.userId });
      return reply.send({
        user: {
          id: req.session.userId,
          subject: req.session.subject ?? req.session.userId,
          email: req.session.email,
          displayName: req.session.displayName,
          avatarUrl: req.session.avatarUrl ?? "",
        },
        teams: teams.teams.map((t) => ({ id: t.id, slug: t.slug, name: t.name })),
      });
    } catch (err) {
      fastify.log.error({ err }, "GetMyTeams failed");
      return reply.code(502).send({ code: "unavailable", message: "identity service unavailable" });
    }
  });
};

export const mePlugin = fp(mePluginFn, { name: "lw-idp-me" });
