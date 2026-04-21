import { connect, runMigrations } from "@lw-idp/db";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outbox, serviceTags } from "../../src/db/schema/index.js";
import {
  createService,
  deleteService,
  getServiceById,
  listServices,
  updateService,
} from "../../src/services/services.js";

describe("catalog-svc services domain", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;

  beforeAll(async () => {
    pg = await startPostgres({ database: "catalog_domain_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
  }, 90_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("createService inserts service + tags and writes an outbox row", async () => {
    const created = await createService(db, {
      slug: "payments-api",
      name: "Payments API",
      description: "Payment processing",
      type: "service",
      lifecycle: "production",
      tags: ["payments", "core"],
    });
    expect(created.slug).toBe("payments-api");
    expect(created.type).toBe("service");

    const tagRows = await db
      .select()
      .from(serviceTags)
      .where(eq(serviceTags.serviceId, created.id));
    expect(tagRows.map((t) => t.tag).sort()).toEqual(["core", "payments"]);

    const events = await db.select().from(outbox).where(eq(outbox.aggregate, "service"));
    const createdEvents = events.filter((e) => e.eventType === "idp.catalog.service.created");
    expect(createdEvents.length).toBeGreaterThanOrEqual(1);
    const payload = createdEvents[createdEvents.length - 1]?.payload as {
      type: string;
      data: { slug: string };
    };
    expect(payload.type).toBe("idp.catalog.service.created");
    expect(payload.data.slug).toBe("payments-api");
  });

  it("createService with duplicate slug throws", async () => {
    await createService(db, { slug: "dup-slug", name: "Dup" });
    await expect(createService(db, { slug: "dup-slug", name: "Dup 2" })).rejects.toThrow();
  });

  it("updateService changes name and replaces tags, writes outbox", async () => {
    const created = await createService(db, {
      slug: "billing-api",
      name: "Billing",
      tags: ["old"],
    });
    const updated = await updateService(db, {
      id: created.id,
      name: "Billing API",
      lifecycle: "production",
      tags: ["new", "billing"],
    });
    expect(updated.name).toBe("Billing API");
    expect(updated.lifecycle).toBe("production");

    const tags = await db.select().from(serviceTags).where(eq(serviceTags.serviceId, updated.id));
    expect(tags.map((t) => t.tag).sort()).toEqual(["billing", "new"]);

    const events = await db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "idp.catalog.service.updated"));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("deleteService removes row and writes outbox event", async () => {
    const created = await createService(db, { slug: "to-delete", name: "Temp" });
    await deleteService(db, { id: created.id });
    const after = await getServiceById(db, created.id);
    expect(after).toBeUndefined();

    const events = await db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "idp.catalog.service.deleted"));
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("deleteService on nonexistent id throws", async () => {
    await expect(deleteService(db, { id: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(
      /not found/i,
    );
  });

  it("listServices paginates + filters by lifecycle", async () => {
    await createService(db, { slug: "prod-1", name: "Prod1", lifecycle: "production" });
    await createService(db, { slug: "prod-2", name: "Prod2", lifecycle: "production" });
    await createService(db, { slug: "exp-1", name: "Exp1", lifecycle: "experimental" });

    const prod = await listServices(db, { lifecycleFilter: "production", limit: 10 });
    const slugs = prod.services.map((s) => s.slug);
    expect(slugs).toEqual(expect.arrayContaining(["prod-1", "prod-2"]));
    for (const s of prod.services) {
      expect(s.lifecycle).toBe("production");
    }
  });
});
