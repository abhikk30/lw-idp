import { connect, runMigrations } from "@lw-idp/db";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clusterTags, outbox } from "../../src/db/schema/index.js";
import {
  deregisterCluster,
  getClusterById,
  listClusters,
  registerCluster,
  updateCluster,
} from "../../src/services/clusters.js";

describe("cluster-svc services domain", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;

  beforeAll(async () => {
    pg = await startPostgres({ database: "cluster_domain_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
  }, 90_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("registerCluster inserts cluster + tags and writes an outbox row", async () => {
    const created = await registerCluster(db, {
      slug: "kind-local",
      name: "Kind Local",
      environment: "dev",
      region: "local",
      provider: "kind",
      tags: ["dev", "local"],
    });
    expect(created.slug).toBe("kind-local");
    expect(created.provider).toBe("kind");

    const tagRows = await db
      .select()
      .from(clusterTags)
      .where(eq(clusterTags.clusterId, created.id));
    expect(tagRows.map((t) => t.tag).sort()).toEqual(["dev", "local"]);

    const events = await db.select().from(outbox).where(eq(outbox.aggregate, "cluster"));
    const registeredEvents = events.filter((e) => e.eventType === "idp.cluster.cluster.registered");
    expect(registeredEvents.length).toBeGreaterThanOrEqual(1);
    const payload = registeredEvents[registeredEvents.length - 1]?.payload as {
      type: string;
      data: { slug: string };
    };
    expect(payload.type).toBe("idp.cluster.cluster.registered");
    expect(payload.data.slug).toBe("kind-local");
  });

  it("registerCluster with duplicate slug throws", async () => {
    await registerCluster(db, { slug: "dup-cluster", name: "Dup" });
    await expect(registerCluster(db, { slug: "dup-cluster", name: "Dup 2" })).rejects.toThrow();
  });

  it("updateCluster changes name and replaces tags, writes outbox", async () => {
    const created = await registerCluster(db, {
      slug: "eks-prod",
      name: "EKS Prod",
      provider: "eks",
      tags: ["old"],
    });
    const updated = await updateCluster(db, {
      id: created.id,
      name: "EKS Production",
      region: "us-east-1",
      tags: ["prod", "eks"],
    });
    expect(updated.name).toBe("EKS Production");
    expect(updated.region).toBe("us-east-1");

    const tags = await db.select().from(clusterTags).where(eq(clusterTags.clusterId, updated.id));
    expect(tags.map((t) => t.tag).sort()).toEqual(["eks", "prod"]);

    const events = await db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "idp.cluster.cluster.updated"));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("deregisterCluster removes row and writes outbox event", async () => {
    const created = await registerCluster(db, { slug: "to-deregister", name: "Temp" });
    await deregisterCluster(db, { id: created.id });
    const after = await getClusterById(db, created.id);
    expect(after).toBeUndefined();

    const events = await db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "idp.cluster.cluster.deregistered"));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("deregisterCluster on nonexistent id throws", async () => {
    await expect(
      deregisterCluster(db, { id: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow(/not found/i);
  });

  it("listClusters paginates + filters by environment", async () => {
    await registerCluster(db, { slug: "prod-cluster-1", name: "Prod1", environment: "prod" });
    await registerCluster(db, { slug: "prod-cluster-2", name: "Prod2", environment: "prod" });
    await registerCluster(db, { slug: "dev-cluster-1", name: "Dev1", environment: "dev" });

    const prod = await listClusters(db, { environmentFilter: "prod", limit: 10 });
    const slugs = prod.clusters.map((c) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(["prod-cluster-1", "prod-cluster-2"]));
    for (const c of prod.clusters) {
      expect(c.environment).toBe("prod");
    }
  });
});
