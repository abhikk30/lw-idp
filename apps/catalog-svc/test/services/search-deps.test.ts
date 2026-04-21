import { connect, runMigrations } from "@lw-idp/db";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outbox, serviceDependencies } from "../../src/db/schema/index.js";
import {
  addDependency,
  createService,
  removeDependency,
  searchServices,
} from "../../src/services/services.js";

describe("catalog-svc search + dependencies", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;

  beforeAll(async () => {
    pg = await startPostgres({ database: "catalog_search_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
  }, 90_000);

  afterAll(async () => {
    await pg?.stop();
  });

  describe("searchServices", () => {
    it("matches by name", async () => {
      await createService(db, {
        slug: "payments-api",
        name: "Payments API",
        description: "Payment processing",
      });
      const res = await searchServices(db, { query: "payment" });
      expect(res.some((s) => s.slug === "payments-api")).toBe(true);
    });

    it("matches by description tokens", async () => {
      await createService(db, {
        slug: "fraud-ml",
        name: "Fraud Detection",
        description: "Machine learning model serving",
      });
      const res = await searchServices(db, { query: "machine" });
      expect(res.some((s) => s.slug === "fraud-ml")).toBe(true);
    });

    it("returns ranked results (name-hit before description-hit)", async () => {
      await createService(db, {
        slug: "billing-hub",
        name: "Billing Hub",
        description: "Handles billing and receipts",
      });
      await createService(db, {
        slug: "logger",
        name: "Logger",
        description: "Also handles billing logs",
      });
      const res = await searchServices(db, { query: "billing" });
      const slugs = res.map((s) => s.slug);
      expect(slugs.indexOf("billing-hub")).toBeLessThan(slugs.indexOf("logger"));
    });

    it("empty query returns empty", async () => {
      const res = await searchServices(db, { query: "   " });
      expect(res).toEqual([]);
    });

    it("no matches returns empty", async () => {
      const res = await searchServices(db, { query: "zzzyyyxxxneverappears" });
      expect(res).toEqual([]);
    });
  });

  describe("dependencies", () => {
    it("addDependency inserts a row + writes outbox; idempotent", async () => {
      const a = await createService(db, { slug: "svc-a", name: "A" });
      const b = await createService(db, { slug: "svc-b", name: "B" });

      const dep = await addDependency(db, {
        serviceId: a.id,
        dependsOnServiceId: b.id,
        kind: "uses",
      });
      expect(dep.serviceId).toBe(a.id);
      expect(dep.dependsOnServiceId).toBe(b.id);
      expect(dep.kind).toBe("uses");

      // Idempotent
      const dep2 = await addDependency(db, {
        serviceId: a.id,
        dependsOnServiceId: b.id,
        kind: "uses",
      });
      expect(dep2.serviceId).toBe(a.id);

      const events = await db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, "idp.catalog.service.dependency.added"));
      // One added event for the first insert; idempotent call does NOT add another
      expect(events.length).toBe(1);
    });

    it("addDependency rejects self-dependency", async () => {
      const s = await createService(db, { slug: "self-dep", name: "Self" });
      await expect(
        addDependency(db, { serviceId: s.id, dependsOnServiceId: s.id, kind: "uses" }),
      ).rejects.toThrow(/itself/i);
    });

    it("removeDependency deletes + writes outbox; idempotent when missing", async () => {
      const c = await createService(db, { slug: "svc-c", name: "C" });
      const d = await createService(db, { slug: "svc-d", name: "D" });
      await addDependency(db, { serviceId: c.id, dependsOnServiceId: d.id, kind: "uses" });

      await removeDependency(db, { serviceId: c.id, dependsOnServiceId: d.id });

      const after = await db
        .select()
        .from(serviceDependencies)
        .where(eq(serviceDependencies.serviceId, c.id));
      expect(after.length).toBe(0);

      const events = await db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, "idp.catalog.service.dependency.removed"));
      expect(events.length).toBeGreaterThanOrEqual(1);

      // Idempotent on missing
      await expect(
        removeDependency(db, { serviceId: c.id, dependsOnServiceId: d.id }),
      ).resolves.toBeUndefined();
    });
  });
});
