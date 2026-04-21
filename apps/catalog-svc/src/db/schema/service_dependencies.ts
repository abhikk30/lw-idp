import { pgEnum, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { services } from "./services.js";

export const dependencyKind = pgEnum("dependency_kind", ["uses", "provides", "consumes"]);

export const serviceDependencies = pgTable(
  "service_dependencies",
  {
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    dependsOnServiceId: uuid("depends_on_service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    kind: dependencyKind("kind").notNull().default("uses"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.serviceId, t.dependsOnServiceId, t.kind] }),
  }),
);

export type ServiceDependency = typeof serviceDependencies.$inferSelect;
export type NewServiceDependency = typeof serviceDependencies.$inferInsert;
