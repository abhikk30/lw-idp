import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import { type ClusterService, Environment, Provider } from "@lw-idp/contracts/cluster/v1";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Cluster as ClusterRow } from "../db/schema/index.js";
import { clusterTags } from "../db/schema/index.js";
import {
  deregisterCluster,
  getClusterById,
  listClusters,
  registerCluster,
  updateCluster,
} from "../services/clusters.js";

export interface ClusterServiceDeps {
  db: PostgresJsDatabase;
}

// Proto enum → DB enum string mappers
function dbEnvironment(e: Environment): "dev" | "stage" | "prod" {
  switch (e) {
    case Environment.STAGE:
      return "stage";
    case Environment.PROD:
      return "prod";
    default:
      return "dev";
  }
}

function protoEnvironment(e: string): Environment {
  switch (e) {
    case "stage":
      return Environment.STAGE;
    case "prod":
      return Environment.PROD;
    default:
      return Environment.DEV;
  }
}

function dbProvider(p: Provider): "docker-desktop" | "eks" | "gke" | "aks" | "kind" | "other" {
  switch (p) {
    case Provider.DOCKER_DESKTOP:
      return "docker-desktop";
    case Provider.EKS:
      return "eks";
    case Provider.GKE:
      return "gke";
    case Provider.AKS:
      return "aks";
    case Provider.KIND:
      return "kind";
    default:
      return "other";
  }
}

function protoProvider(p: string): Provider {
  switch (p) {
    case "docker-desktop":
      return Provider.DOCKER_DESKTOP;
    case "eks":
      return Provider.EKS;
    case "gke":
      return Provider.GKE;
    case "aks":
      return Provider.AKS;
    case "kind":
      return Provider.KIND;
    default:
      return Provider.OTHER;
  }
}

async function toProtoCluster(
  db: PostgresJsDatabase,
  row: ClusterRow,
): Promise<{
  id: string;
  slug: string;
  name: string;
  environment: Environment;
  region: string;
  provider: Provider;
  apiEndpoint: string;
  tags: string[];
  createdAt?: ReturnType<typeof timestampFromDate>;
}> {
  const tagRows = await db.select().from(clusterTags).where(eq(clusterTags.clusterId, row.id));
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    environment: protoEnvironment(row.environment),
    region: row.region,
    provider: protoProvider(row.provider),
    apiEndpoint: row.apiEndpoint,
    tags: tagRows.map((t) => t.tag),
    createdAt: timestampFromDate(row.createdAt),
  };
}

export function makeClusterServiceImpl(
  deps: ClusterServiceDeps,
): ServiceImpl<typeof ClusterService> {
  return {
    async registerCluster(req) {
      if (!req.slug || !req.name) {
        throw new ConnectError("slug and name required", Code.InvalidArgument);
      }
      try {
        const registerInput: Parameters<typeof registerCluster>[1] = {
          slug: req.slug,
          name: req.name,
          tags: req.tags,
        };
        if (req.environment !== Environment.UNSPECIFIED) {
          registerInput.environment = dbEnvironment(req.environment);
        }
        if (req.region) {
          registerInput.region = req.region;
        }
        if (req.provider !== Provider.UNSPECIFIED) {
          registerInput.provider = dbProvider(req.provider);
        }
        if (req.apiEndpoint) {
          registerInput.apiEndpoint = req.apiEndpoint;
        }
        const created = await registerCluster(deps.db, registerInput);
        return { cluster: await toProtoCluster(deps.db, created) };
      } catch (err) {
        if (err instanceof Error && /duplicate key|unique constraint/i.test(err.message)) {
          throw new ConnectError(
            `cluster with slug '${req.slug}' already exists`,
            Code.AlreadyExists,
          );
        }
        throw err;
      }
    },

    async updateCluster(req) {
      if (!req.id) {
        throw new ConnectError("id required", Code.InvalidArgument);
      }
      try {
        const updated = await updateCluster(deps.db, {
          id: req.id,
          ...(req.name !== "" ? { name: req.name } : {}),
          ...(req.region !== "" ? { region: req.region } : {}),
          ...(req.apiEndpoint !== "" ? { apiEndpoint: req.apiEndpoint } : {}),
          tags: req.tags,
        });
        return { cluster: await toProtoCluster(deps.db, updated) };
      } catch (err) {
        if (err instanceof Error && /not found/i.test(err.message)) {
          throw new ConnectError(`cluster not found: ${req.id}`, Code.NotFound);
        }
        throw err;
      }
    },

    async deregisterCluster(req) {
      if (!req.id) {
        throw new ConnectError("id required", Code.InvalidArgument);
      }
      try {
        await deregisterCluster(deps.db, { id: req.id });
        return {};
      } catch (err) {
        if (err instanceof Error && /not found/i.test(err.message)) {
          throw new ConnectError(`cluster not found: ${req.id}`, Code.NotFound);
        }
        throw err;
      }
    },

    async getCluster(req) {
      const row = await getClusterById(deps.db, req.id);
      if (!row) {
        throw new ConnectError(`cluster not found: ${req.id}`, Code.NotFound);
      }
      return { cluster: await toProtoCluster(deps.db, row) };
    },

    async listClusters(req) {
      const res = await listClusters(deps.db, {
        ...(req.limit > 0 ? { limit: req.limit } : {}),
        pageToken: req.pageToken,
        ...(req.environmentFilter !== Environment.UNSPECIFIED
          ? { environmentFilter: dbEnvironment(req.environmentFilter) }
          : {}),
        ...(req.providerFilter !== Provider.UNSPECIFIED
          ? { providerFilter: dbProvider(req.providerFilter) }
          : {}),
      });
      const out = await Promise.all(res.clusters.map((r) => toProtoCluster(deps.db, r)));
      return { clusters: out, nextPageToken: res.nextPageToken };
    },
  };
}
