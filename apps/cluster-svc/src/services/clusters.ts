import { createEnvelope } from "@lw-idp/events";
import { and, asc, eq, gt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  type Cluster,
  type NewCluster,
  clusterTags,
  clusters,
  outbox,
} from "../db/schema/index.js";

type EnvironmentType = "dev" | "stage" | "prod";
type ProviderType = "docker-desktop" | "eks" | "gke" | "aks" | "kind" | "other";

export interface RegisterClusterInput {
  slug: string;
  name: string;
  environment?: EnvironmentType;
  region?: string;
  provider?: ProviderType;
  apiEndpoint?: string;
  tags?: string[];
  actorUserId?: string;
}

export async function registerCluster(
  db: PostgresJsDatabase,
  input: RegisterClusterInput,
): Promise<Cluster> {
  return db.transaction(async (tx) => {
    const values: NewCluster = {
      slug: input.slug,
      name: input.name,
      environment: input.environment ?? "dev",
      region: input.region ?? "",
      provider: input.provider ?? "other",
      apiEndpoint: input.apiEndpoint ?? "",
    };
    const [created] = await tx.insert(clusters).values(values).returning();
    if (!created) {
      throw new Error("cluster insert failed");
    }

    if (input.tags && input.tags.length > 0) {
      await tx
        .insert(clusterTags)
        .values(input.tags.map((tag) => ({ clusterId: created.id, tag })));
    }

    const envelope = createEnvelope({
      type: "idp.cluster.cluster.registered",
      source: "cluster-svc",
      data: {
        id: created.id,
        slug: created.slug,
        name: created.name,
        environment: created.environment,
        region: created.region,
        provider: created.provider,
        apiEndpoint: created.apiEndpoint,
        tags: input.tags ?? [],
      },
      ...(input.actorUserId !== undefined ? { actor: { userId: input.actorUserId } } : {}),
    });
    await tx.insert(outbox).values({
      aggregate: "cluster",
      eventType: envelope.type,
      payload: envelope,
    });

    return created;
  });
}

export interface UpdateClusterInput {
  id: string;
  name?: string;
  region?: string;
  apiEndpoint?: string;
  tags?: string[];
  actorUserId?: string;
}

export async function updateCluster(
  db: PostgresJsDatabase,
  input: UpdateClusterInput,
): Promise<Cluster> {
  return db.transaction(async (tx) => {
    const patch: Partial<NewCluster> = {};
    if (input.name !== undefined) {
      patch.name = input.name;
    }
    if (input.region !== undefined) {
      patch.region = input.region;
    }
    if (input.apiEndpoint !== undefined) {
      patch.apiEndpoint = input.apiEndpoint;
    }

    const [updated] = await tx
      .update(clusters)
      .set(patch)
      .where(eq(clusters.id, input.id))
      .returning();
    if (!updated) {
      throw new Error(`cluster not found: ${input.id}`);
    }

    if (input.tags !== undefined) {
      await tx.delete(clusterTags).where(eq(clusterTags.clusterId, updated.id));
      if (input.tags.length > 0) {
        await tx
          .insert(clusterTags)
          .values(input.tags.map((tag) => ({ clusterId: updated.id, tag })));
      }
    }

    const envelope = createEnvelope({
      type: "idp.cluster.cluster.updated",
      source: "cluster-svc",
      data: {
        id: updated.id,
        slug: updated.slug,
        name: updated.name,
      },
      ...(input.actorUserId !== undefined ? { actor: { userId: input.actorUserId } } : {}),
    });
    await tx.insert(outbox).values({
      aggregate: "cluster",
      eventType: envelope.type,
      payload: envelope,
    });

    return updated;
  });
}

export interface DeregisterClusterInput {
  id: string;
  actorUserId?: string;
}

export async function deregisterCluster(
  db: PostgresJsDatabase,
  input: DeregisterClusterInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(clusters).where(eq(clusters.id, input.id)).limit(1);
    if (!existing) {
      throw new Error(`cluster not found: ${input.id}`);
    }

    await tx.delete(clusters).where(eq(clusters.id, input.id));

    const envelope = createEnvelope({
      type: "idp.cluster.cluster.deregistered",
      source: "cluster-svc",
      data: { id: existing.id, slug: existing.slug },
      ...(input.actorUserId !== undefined ? { actor: { userId: input.actorUserId } } : {}),
    });
    await tx.insert(outbox).values({
      aggregate: "cluster",
      eventType: envelope.type,
      payload: envelope,
    });
  });
}

export async function getClusterById(
  db: PostgresJsDatabase,
  id: string,
): Promise<Cluster | undefined> {
  const [row] = await db.select().from(clusters).where(eq(clusters.id, id)).limit(1);
  return row;
}

export interface ListClustersInput {
  limit?: number;
  pageToken?: string;
  environmentFilter?: EnvironmentType;
  providerFilter?: ProviderType;
}

export interface ListClustersResult {
  clusters: Cluster[];
  nextPageToken: string;
}

export async function listClusters(
  db: PostgresJsDatabase,
  opts: ListClustersInput,
): Promise<ListClustersResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let cursor: string | undefined;
  if (opts.pageToken && opts.pageToken.length > 0) {
    try {
      cursor = Buffer.from(opts.pageToken, "base64url").toString("utf8");
    } catch {
      cursor = undefined;
    }
  }

  const conditions: ReturnType<typeof eq>[] = [];
  if (cursor) {
    conditions.push(gt(clusters.id, cursor));
  }
  if (opts.environmentFilter) {
    conditions.push(eq(clusters.environment, opts.environmentFilter));
  }
  if (opts.providerFilter) {
    conditions.push(eq(clusters.provider, opts.providerFilter));
  }

  const rows = await db
    .select()
    .from(clusters)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(clusters.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore
    ? Buffer.from(page[page.length - 1]?.id ?? "", "utf8").toString("base64url")
    : "";
  return { clusters: page, nextPageToken: next };
}
