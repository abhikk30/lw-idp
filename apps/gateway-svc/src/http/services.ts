import { Code, ConnectError } from "@connectrpc/connect";
import {
  Lifecycle as ProtoLifecycle,
  type Service as ProtoService,
  ServiceType as ProtoServiceType,
} from "@lw-idp/contracts/catalog/v1";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import type { CatalogClient } from "../clients/catalog.js";

export interface ServicesPluginOptions {
  catalogClient: CatalogClient;
}

type RestServiceType = "service" | "library" | "website" | "ml" | "job";
type RestLifecycle = "experimental" | "production" | "deprecated";

function protoToRestType(t: ProtoServiceType): RestServiceType {
  switch (t) {
    case ProtoServiceType.LIBRARY:
      return "library";
    case ProtoServiceType.WEBSITE:
      return "website";
    case ProtoServiceType.ML:
      return "ml";
    case ProtoServiceType.JOB:
      return "job";
    default:
      return "service";
  }
}

function restToProtoType(t: RestServiceType | undefined): ProtoServiceType {
  switch (t) {
    case "library":
      return ProtoServiceType.LIBRARY;
    case "website":
      return ProtoServiceType.WEBSITE;
    case "ml":
      return ProtoServiceType.ML;
    case "job":
      return ProtoServiceType.JOB;
    case "service":
      return ProtoServiceType.SERVICE;
    default:
      return ProtoServiceType.UNSPECIFIED;
  }
}

function protoToRestLifecycle(l: ProtoLifecycle): RestLifecycle {
  switch (l) {
    case ProtoLifecycle.PRODUCTION:
      return "production";
    case ProtoLifecycle.DEPRECATED:
      return "deprecated";
    default:
      return "experimental";
  }
}

function restToProtoLifecycle(l: RestLifecycle | undefined): ProtoLifecycle {
  switch (l) {
    case "production":
      return ProtoLifecycle.PRODUCTION;
    case "deprecated":
      return ProtoLifecycle.DEPRECATED;
    case "experimental":
      return ProtoLifecycle.EXPERIMENTAL;
    default:
      return ProtoLifecycle.UNSPECIFIED;
  }
}

function toRestService(s: ProtoService) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    type: protoToRestType(s.type),
    lifecycle: protoToRestLifecycle(s.lifecycle),
    ownerTeamId: s.ownerTeamId || undefined,
    repoUrl: s.repoUrl || undefined,
    tags: s.tags,
    createdAt: s.createdAt ? new Date(Number(s.createdAt.seconds) * 1000).toISOString() : undefined,
    updatedAt: s.updatedAt ? new Date(Number(s.updatedAt.seconds) * 1000).toISOString() : undefined,
  };
}

function mapConnectError(err: unknown, reply: FastifyReply): boolean {
  if (!(err instanceof ConnectError)) {
    return false;
  }
  const map: Partial<Record<Code, { status: number; code: string }>> = {
    [Code.NotFound]: { status: 404, code: "not_found" },
    [Code.AlreadyExists]: { status: 409, code: "conflict" },
    [Code.InvalidArgument]: { status: 400, code: "bad_request" },
    [Code.Unauthenticated]: { status: 401, code: "unauthorized" },
    [Code.PermissionDenied]: { status: 403, code: "forbidden" },
    [Code.ResourceExhausted]: { status: 429, code: "rate_limited" },
    [Code.Unavailable]: { status: 503, code: "unavailable" },
  };
  const m = map[err.code] ?? { status: 500, code: "internal" };
  reply.code(m.status).send({ code: m.code, message: err.rawMessage });
  return true;
}

const servicesPluginFn: FastifyPluginAsync<ServicesPluginOptions> = async (fastify, opts) => {
  fastify.get<{
    Querystring: {
      q?: string;
      team?: string;
      type?: RestServiceType;
      lifecycle?: RestLifecycle;
      limit?: number;
      cursor?: string;
    };
  }>("/api/v1/services", async (req, reply) => {
    try {
      if (req.query.q) {
        const out = await opts.catalogClient.searchServices({
          query: req.query.q,
          limit: req.query.limit ?? 50,
        });
        return reply.send({ items: out.services.map(toRestService) });
      }
      const out = await opts.catalogClient.listServices({
        limit: req.query.limit ?? 50,
        pageToken: req.query.cursor ?? "",
        typeFilter: restToProtoType(req.query.type),
        lifecycleFilter: restToProtoLifecycle(req.query.lifecycle),
        ownerTeamId: req.query.team ?? "",
      });
      return reply.send({
        items: out.services.map(toRestService),
        ...(out.nextPageToken ? { nextCursor: out.nextPageToken } : {}),
      });
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return;
      }
      fastify.log.error({ err }, "listServices failed");
      return reply.code(500).send({ code: "internal", message: "list failed" });
    }
  });

  fastify.post<{
    Body: {
      slug: string;
      name: string;
      description?: string;
      type: RestServiceType;
      lifecycle?: RestLifecycle;
      ownerTeamId?: string;
      repoUrl?: string;
      tags?: string[];
    };
  }>("/api/v1/services", async (req, reply) => {
    try {
      const created = await opts.catalogClient.createService({
        slug: req.body.slug,
        name: req.body.name,
        description: req.body.description ?? "",
        type: restToProtoType(req.body.type),
        lifecycle: restToProtoLifecycle(req.body.lifecycle),
        ownerTeamId: req.body.ownerTeamId ?? "",
        repoUrl: req.body.repoUrl ?? "",
        tags: req.body.tags ?? [],
      });
      if (!created.service) {
        return reply.code(500).send({ code: "internal", message: "no service returned" });
      }
      return reply.code(201).send(toRestService(created.service));
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return;
      }
      throw err;
    }
  });

  fastify.get<{ Params: { id: string } }>("/api/v1/services/:id", async (req, reply) => {
    try {
      const got = await opts.catalogClient.getService({ id: req.params.id });
      if (!got.service) {
        return reply.code(404).send({ code: "not_found", message: "service not found" });
      }
      return reply.send(toRestService(got.service));
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return;
      }
      throw err;
    }
  });

  fastify.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      lifecycle?: RestLifecycle;
      ownerTeamId?: string;
      repoUrl?: string;
      tags?: string[];
    };
  }>("/api/v1/services/:id", async (req, reply) => {
    try {
      const updated = await opts.catalogClient.updateService({
        id: req.params.id,
        name: req.body.name ?? "",
        description: req.body.description ?? "",
        lifecycle: restToProtoLifecycle(req.body.lifecycle),
        ownerTeamId: req.body.ownerTeamId ?? "",
        repoUrl: req.body.repoUrl ?? "",
        tags: req.body.tags ?? [],
      });
      if (!updated.service) {
        return reply.code(404).send({ code: "not_found", message: "service not found" });
      }
      return reply.send(toRestService(updated.service));
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return;
      }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: string } }>("/api/v1/services/:id", async (req, reply) => {
    try {
      await opts.catalogClient.deleteService({ id: req.params.id });
      return reply.code(204).send();
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return;
      }
      throw err;
    }
  });
};

export const servicesPlugin = fp(servicesPluginFn, { name: "lw-idp-services-rest" });
