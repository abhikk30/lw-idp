import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const environment = pgEnum("environment", ["dev", "stage", "prod"]);
export const provider = pgEnum("provider", [
  "docker-desktop",
  "eks",
  "gke",
  "aks",
  "kind",
  "other",
]);

export const clusters = pgTable(
  "clusters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    environment: environment("environment").notNull().default("dev"),
    region: text("region").notNull().default(""),
    provider: provider("provider").notNull().default("other"),
    apiEndpoint: text("api_endpoint").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUnique: uniqueIndex("clusters_slug_unique").on(t.slug),
  }),
);

export type Cluster = typeof clusters.$inferSelect;
export type NewCluster = typeof clusters.$inferInsert;
