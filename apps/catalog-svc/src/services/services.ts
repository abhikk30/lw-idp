import { createEnvelope } from "@lw-idp/events";
import { and, asc, eq, gt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  type NewService,
  type Service,
  outbox,
  serviceTags,
  services,
} from "../db/schema/index.js";

type ServiceType = "service" | "library" | "website" | "ml" | "job";
type Lifecycle = "experimental" | "production" | "deprecated";

export interface CreateServiceInput {
  slug: string;
  name: string;
  description?: string;
  type?: ServiceType;
  lifecycle?: Lifecycle;
  ownerTeamId?: string;
  repoUrl?: string;
  tags?: string[];
  actorUserId?: string;
}

export async function createService(
  db: PostgresJsDatabase,
  input: CreateServiceInput,
): Promise<Service> {
  return db.transaction(async (tx) => {
    const values: NewService = {
      slug: input.slug,
      name: input.name,
      description: input.description ?? "",
      type: input.type ?? "service",
      lifecycle: input.lifecycle ?? "experimental",
      repoUrl: input.repoUrl ?? "",
      ...(input.ownerTeamId !== undefined ? { ownerTeamId: input.ownerTeamId } : {}),
    };
    const [created] = await tx.insert(services).values(values).returning();
    if (!created) {
      throw new Error("service insert failed");
    }

    if (input.tags && input.tags.length > 0) {
      await tx
        .insert(serviceTags)
        .values(input.tags.map((tag) => ({ serviceId: created.id, tag })));
    }

    const envelope = createEnvelope({
      type: "idp.catalog.service.created",
      source: "catalog-svc",
      data: {
        id: created.id,
        slug: created.slug,
        name: created.name,
        type: created.type,
        lifecycle: created.lifecycle,
        ownerTeamId: created.ownerTeamId ?? undefined,
        tags: input.tags ?? [],
      },
      ...(input.actorUserId !== undefined ? { actor: { userId: input.actorUserId } } : {}),
    });
    await tx.insert(outbox).values({
      aggregate: "service",
      eventType: envelope.type,
      payload: envelope,
    });

    return created;
  });
}

export interface UpdateServiceInput {
  id: string;
  name?: string;
  description?: string;
  lifecycle?: Lifecycle;
  ownerTeamId?: string;
  repoUrl?: string;
  tags?: string[];
  actorUserId?: string;
}

export async function updateService(
  db: PostgresJsDatabase,
  input: UpdateServiceInput,
): Promise<Service> {
  return db.transaction(async (tx) => {
    const patch: Partial<NewService> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      patch.name = input.name;
    }
    if (input.description !== undefined) {
      patch.description = input.description;
    }
    if (input.lifecycle !== undefined) {
      patch.lifecycle = input.lifecycle;
    }
    if (input.ownerTeamId !== undefined) {
      patch.ownerTeamId = input.ownerTeamId;
    }
    if (input.repoUrl !== undefined) {
      patch.repoUrl = input.repoUrl;
    }

    const [updated] = await tx
      .update(services)
      .set(patch)
      .where(eq(services.id, input.id))
      .returning();
    if (!updated) {
      throw new Error(`service not found: ${input.id}`);
    }

    if (input.tags !== undefined) {
      await tx.delete(serviceTags).where(eq(serviceTags.serviceId, updated.id));
      if (input.tags.length > 0) {
        await tx
          .insert(serviceTags)
          .values(input.tags.map((tag) => ({ serviceId: updated.id, tag })));
      }
    }

    const envelope = createEnvelope({
      type: "idp.catalog.service.updated",
      source: "catalog-svc",
      data: {
        id: updated.id,
        slug: updated.slug,
        name: updated.name,
        lifecycle: updated.lifecycle,
      },
      ...(input.actorUserId !== undefined ? { actor: { userId: input.actorUserId } } : {}),
    });
    await tx.insert(outbox).values({
      aggregate: "service",
      eventType: envelope.type,
      payload: envelope,
    });

    return updated;
  });
}

export interface DeleteServiceInput {
  id: string;
  actorUserId?: string;
}

export async function deleteService(
  db: PostgresJsDatabase,
  input: DeleteServiceInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(services).where(eq(services.id, input.id)).limit(1);
    if (!existing) {
      throw new Error(`service not found: ${input.id}`);
    }

    await tx.delete(services).where(eq(services.id, input.id));

    const envelope = createEnvelope({
      type: "idp.catalog.service.deleted",
      source: "catalog-svc",
      data: { id: existing.id, slug: existing.slug },
      ...(input.actorUserId !== undefined ? { actor: { userId: input.actorUserId } } : {}),
    });
    await tx.insert(outbox).values({
      aggregate: "service",
      eventType: envelope.type,
      payload: envelope,
    });
  });
}

export async function getServiceById(
  db: PostgresJsDatabase,
  id: string,
): Promise<Service | undefined> {
  const [row] = await db.select().from(services).where(eq(services.id, id)).limit(1);
  return row;
}

export interface ListServicesInput {
  limit?: number;
  pageToken?: string;
  typeFilter?: ServiceType;
  lifecycleFilter?: Lifecycle;
  ownerTeamId?: string;
}

export interface ListServicesResult {
  services: Service[];
  nextPageToken: string;
}

export async function listServices(
  db: PostgresJsDatabase,
  opts: ListServicesInput,
): Promise<ListServicesResult> {
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
    conditions.push(gt(services.id, cursor));
  }
  if (opts.typeFilter) {
    conditions.push(eq(services.type, opts.typeFilter));
  }
  if (opts.lifecycleFilter) {
    conditions.push(eq(services.lifecycle, opts.lifecycleFilter));
  }
  if (opts.ownerTeamId) {
    conditions.push(eq(services.ownerTeamId, opts.ownerTeamId));
  }

  const rows = await db
    .select()
    .from(services)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(services.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore
    ? Buffer.from(page[page.length - 1]?.id ?? "", "utf8").toString("base64url")
    : "";
  return { services: page, nextPageToken: next };
}
