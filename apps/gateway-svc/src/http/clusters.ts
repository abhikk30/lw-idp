import { Code, ConnectError } from "@connectrpc/connect";
import {
  type Cluster as ProtoCluster,
  Environment as ProtoEnv,
  Provider as ProtoProv,
} from "@lw-idp/contracts/cluster/v1";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import type { ClusterClient } from "../clients/cluster.js";

export interface ClustersPluginOptions {
  clusterClient: ClusterClient;
}

type RestEnv = "dev" | "stage" | "prod";
type RestProv = "docker-desktop" | "eks" | "gke" | "aks" | "kind" | "other";

function protoToRestEnv(e: ProtoEnv): RestEnv {
  switch (e) {
    case ProtoEnv.STAGE:
      return "stage";
    case ProtoEnv.PROD:
      return "prod";
    default:
      return "dev";
  }
}

function restToProtoEnv(e: RestEnv | undefined): ProtoEnv {
  switch (e) {
    case "stage":
      return ProtoEnv.STAGE;
    case "prod":
      return ProtoEnv.PROD;
    case "dev":
      return ProtoEnv.DEV;
    default:
      return ProtoEnv.UNSPECIFIED;
  }
}

function protoToRestProv(p: ProtoProv): RestProv {
  switch (p) {
    case ProtoProv.DOCKER_DESKTOP:
      return "docker-desktop";
    case ProtoProv.EKS:
      return "eks";
    case ProtoProv.GKE:
      return "gke";
    case ProtoProv.AKS:
      return "aks";
    case ProtoProv.KIND:
      return "kind";
    default:
      return "other";
  }
}

function restToProtoProv(p: RestProv | undefined): ProtoProv {
  switch (p) {
    case "docker-desktop":
      return ProtoProv.DOCKER_DESKTOP;
    case "eks":
      return ProtoProv.EKS;
    case "gke":
      return ProtoProv.GKE;
    case "aks":
      return ProtoProv.AKS;
    case "kind":
      return ProtoProv.KIND;
    case "other":
      return ProtoProv.OTHER;
    default:
      return ProtoProv.UNSPECIFIED;
  }
}

function toRestCluster(c: ProtoCluster) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    environment: protoToRestEnv(c.environment),
    region: c.region || undefined,
    provider: protoToRestProv(c.provider),
    apiEndpoint: c.apiEndpoint || undefined,
    tags: c.tags,
    createdAt: c.createdAt ? new Date(Number(c.createdAt.seconds) * 1000).toISOString() : undefined,
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

const clustersPluginFn: FastifyPluginAsync<ClustersPluginOptions> = async (fastify, opts) => {
  fastify.get<{
    Querystring: {
      env?: RestEnv;
      provider?: RestProv;
      limit?: number;
      cursor?: string;
    };
  }>("/api/v1/clusters", async (req, reply) => {
    try {
      const out = await opts.clusterClient.listClusters({
        limit: req.query.limit ?? 50,
        pageToken: req.query.cursor ?? "",
        environmentFilter: restToProtoEnv(req.query.env),
        providerFilter: restToProtoProv(req.query.provider),
      });
      return reply.send({
        items: out.clusters.map(toRestCluster),
        ...(out.nextPageToken ? { nextCursor: out.nextPageToken } : {}),
      });
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return reply;
      }
      throw err;
    }
  });

  fastify.post<{
    Body: {
      slug: string;
      name: string;
      environment: RestEnv;
      region?: string;
      provider: RestProv;
      apiEndpoint?: string;
      tags?: string[];
    };
  }>("/api/v1/clusters", async (req, reply) => {
    try {
      const created = await opts.clusterClient.registerCluster({
        slug: req.body.slug,
        name: req.body.name,
        environment: restToProtoEnv(req.body.environment),
        region: req.body.region ?? "",
        provider: restToProtoProv(req.body.provider),
        apiEndpoint: req.body.apiEndpoint ?? "",
        tags: req.body.tags ?? [],
      });
      if (!created.cluster) {
        return reply.code(500).send({ code: "internal", message: "no cluster returned" });
      }
      return reply.code(201).send(toRestCluster(created.cluster));
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return reply;
      }
      throw err;
    }
  });

  fastify.get<{ Params: { id: string } }>("/api/v1/clusters/:id", async (req, reply) => {
    try {
      const got = await opts.clusterClient.getCluster({ id: req.params.id });
      if (!got.cluster) {
        return reply.code(404).send({ code: "not_found", message: "cluster not found" });
      }
      return reply.send(toRestCluster(got.cluster));
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return reply;
      }
      throw err;
    }
  });

  fastify.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      region?: string;
      apiEndpoint?: string;
      tags?: string[];
    };
  }>("/api/v1/clusters/:id", async (req, reply) => {
    try {
      const updated = await opts.clusterClient.updateCluster({
        id: req.params.id,
        name: req.body.name ?? "",
        region: req.body.region ?? "",
        apiEndpoint: req.body.apiEndpoint ?? "",
        tags: req.body.tags ?? [],
      });
      if (!updated.cluster) {
        return reply.code(404).send({ code: "not_found", message: "cluster not found" });
      }
      return reply.send(toRestCluster(updated.cluster));
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return reply;
      }
      throw err;
    }
  });

  fastify.delete<{ Params: { id: string } }>("/api/v1/clusters/:id", async (req, reply) => {
    try {
      await opts.clusterClient.deregisterCluster({ id: req.params.id });
      return reply.code(204).send();
    } catch (err) {
      if (mapConnectError(err, reply)) {
        return reply;
      }
      throw err;
    }
  });
};

export const clustersPlugin = fp(clustersPluginFn, { name: "lw-idp-clusters-rest" });
