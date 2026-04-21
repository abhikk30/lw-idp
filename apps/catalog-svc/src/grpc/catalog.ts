import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  type CatalogService,
  DependencyKind,
  Lifecycle,
  ServiceType,
} from "@lw-idp/contracts/catalog/v1";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Service as ServiceRow } from "../db/schema/index.js";
import { serviceTags } from "../db/schema/index.js";
import {
  type DependencyKind as DbDepKind,
  addDependency,
  createService,
  deleteService,
  getServiceById,
  listServices,
  removeDependency,
  searchServices,
  updateService,
} from "../services/services.js";

export interface CatalogServiceDeps {
  db: PostgresJsDatabase;
}

// Proto enum → DB enum string mappers
function dbServiceType(t: ServiceType): "service" | "library" | "website" | "ml" | "job" {
  switch (t) {
    case ServiceType.LIBRARY:
      return "library";
    case ServiceType.WEBSITE:
      return "website";
    case ServiceType.ML:
      return "ml";
    case ServiceType.JOB:
      return "job";
    default:
      return "service";
  }
}

function protoServiceType(t: string): ServiceType {
  switch (t) {
    case "library":
      return ServiceType.LIBRARY;
    case "website":
      return ServiceType.WEBSITE;
    case "ml":
      return ServiceType.ML;
    case "job":
      return ServiceType.JOB;
    default:
      return ServiceType.SERVICE;
  }
}

function dbLifecycle(l: Lifecycle): "experimental" | "production" | "deprecated" {
  switch (l) {
    case Lifecycle.PRODUCTION:
      return "production";
    case Lifecycle.DEPRECATED:
      return "deprecated";
    default:
      return "experimental";
  }
}

function protoLifecycle(l: string): Lifecycle {
  switch (l) {
    case "production":
      return Lifecycle.PRODUCTION;
    case "deprecated":
      return Lifecycle.DEPRECATED;
    default:
      return Lifecycle.EXPERIMENTAL;
  }
}

function dbDepKind(k: DependencyKind): DbDepKind {
  switch (k) {
    case DependencyKind.PROVIDES:
      return "provides";
    case DependencyKind.CONSUMES:
      return "consumes";
    default:
      return "uses";
  }
}

async function toProtoService(
  db: PostgresJsDatabase,
  row: ServiceRow,
): Promise<{
  id: string;
  slug: string;
  name: string;
  description: string;
  type: ServiceType;
  lifecycle: Lifecycle;
  ownerTeamId: string;
  repoUrl: string;
  tags: string[];
  createdAt?: ReturnType<typeof timestampFromDate>;
  updatedAt?: ReturnType<typeof timestampFromDate>;
}> {
  const tagRows = await db.select().from(serviceTags).where(eq(serviceTags.serviceId, row.id));
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    type: protoServiceType(row.type),
    lifecycle: protoLifecycle(row.lifecycle),
    ownerTeamId: row.ownerTeamId ?? "",
    repoUrl: row.repoUrl,
    tags: tagRows.map((t) => t.tag),
    createdAt: timestampFromDate(row.createdAt),
    updatedAt: timestampFromDate(row.updatedAt),
  };
}

export function makeCatalogServiceImpl(
  deps: CatalogServiceDeps,
): ServiceImpl<typeof CatalogService> {
  return {
    async createService(req) {
      if (!req.slug || !req.name) {
        throw new ConnectError("slug and name required", Code.InvalidArgument);
      }
      try {
        const created = await createService(deps.db, {
          slug: req.slug,
          name: req.name,
          description: req.description,
          type: dbServiceType(req.type),
          lifecycle: dbLifecycle(req.lifecycle),
          ...(req.ownerTeamId !== "" ? { ownerTeamId: req.ownerTeamId } : {}),
          repoUrl: req.repoUrl,
          tags: req.tags,
        });
        return { service: await toProtoService(deps.db, created) };
      } catch (err) {
        if (err instanceof Error && /duplicate key|unique constraint/i.test(err.message)) {
          throw new ConnectError(
            `service with slug '${req.slug}' already exists`,
            Code.AlreadyExists,
          );
        }
        throw err;
      }
    },

    async updateService(req) {
      if (!req.id) {
        throw new ConnectError("id required", Code.InvalidArgument);
      }
      try {
        const updated = await updateService(deps.db, {
          id: req.id,
          ...(req.name !== "" ? { name: req.name } : {}),
          description: req.description,
          lifecycle: dbLifecycle(req.lifecycle),
          ...(req.ownerTeamId !== "" ? { ownerTeamId: req.ownerTeamId } : {}),
          repoUrl: req.repoUrl,
          tags: req.tags,
        });
        return { service: await toProtoService(deps.db, updated) };
      } catch (err) {
        if (err instanceof Error && /not found/i.test(err.message)) {
          throw new ConnectError(`service not found: ${req.id}`, Code.NotFound);
        }
        throw err;
      }
    },

    async deleteService(req) {
      if (!req.id) {
        throw new ConnectError("id required", Code.InvalidArgument);
      }
      try {
        await deleteService(deps.db, { id: req.id });
        return {};
      } catch (err) {
        if (err instanceof Error && /not found/i.test(err.message)) {
          throw new ConnectError(`service not found: ${req.id}`, Code.NotFound);
        }
        throw err;
      }
    },

    async getService(req) {
      const row = await getServiceById(deps.db, req.id);
      if (!row) {
        throw new ConnectError(`service not found: ${req.id}`, Code.NotFound);
      }
      return { service: await toProtoService(deps.db, row) };
    },

    async listServices(req) {
      const res = await listServices(deps.db, {
        ...(req.limit > 0 ? { limit: req.limit } : {}),
        pageToken: req.pageToken,
        ...(req.typeFilter !== ServiceType.UNSPECIFIED
          ? { typeFilter: dbServiceType(req.typeFilter) }
          : {}),
        ...(req.lifecycleFilter !== Lifecycle.UNSPECIFIED
          ? { lifecycleFilter: dbLifecycle(req.lifecycleFilter) }
          : {}),
        ...(req.ownerTeamId !== "" ? { ownerTeamId: req.ownerTeamId } : {}),
      });
      const out = await Promise.all(res.services.map((r) => toProtoService(deps.db, r)));
      return { services: out, nextPageToken: res.nextPageToken };
    },

    async searchServices(req) {
      const results = await searchServices(deps.db, {
        query: req.query,
        ...(req.limit > 0 ? { limit: req.limit } : {}),
      });
      const out = await Promise.all(results.map((r) => toProtoService(deps.db, r)));
      return { services: out };
    },

    async addDependency(req) {
      if (!req.serviceId || !req.dependsOnServiceId) {
        throw new ConnectError(
          "service_id and depends_on_service_id required",
          Code.InvalidArgument,
        );
      }
      try {
        await addDependency(deps.db, {
          serviceId: req.serviceId,
          dependsOnServiceId: req.dependsOnServiceId,
          kind: dbDepKind(req.kind),
        });
        return {};
      } catch (err) {
        if (err instanceof Error && /itself/i.test(err.message)) {
          throw new ConnectError(err.message, Code.InvalidArgument);
        }
        throw err;
      }
    },

    async removeDependency(req) {
      await removeDependency(deps.db, {
        serviceId: req.serviceId,
        dependsOnServiceId: req.dependsOnServiceId,
      });
      return {};
    },
  };
}
