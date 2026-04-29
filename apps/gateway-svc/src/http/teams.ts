import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { IdentityClient } from "../clients/identity.js";

export interface TeamsPluginOptions {
  identityClient: IdentityClient;
}

const teamsPluginFn: FastifyPluginAsync<TeamsPluginOptions> = async (fastify, opts) => {
  fastify.get("/api/v1/teams", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ code: "unauthorized", message: "authentication required" });
    }
    try {
      const result = await opts.identityClient.listTeams({ limit: 100, pageToken: "" });
      return reply.send({
        teams: result.teams.map((t) => ({ id: t.id, slug: t.slug, name: t.name })),
      });
    } catch (err) {
      fastify.log.error({ err }, "ListTeams failed");
      return reply.code(502).send({ code: "unavailable", message: "identity service unavailable" });
    }
  });
};

export const teamsPlugin = fp(teamsPluginFn, { name: "lw-idp-teams" });
