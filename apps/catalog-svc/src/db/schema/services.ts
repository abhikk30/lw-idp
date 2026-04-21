import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const serviceType = pgEnum("service_type", ["service", "library", "website", "ml", "job"]);
export const lifecycle = pgEnum("lifecycle", ["experimental", "production", "deprecated"]);

export const services = pgTable(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    type: serviceType("type").notNull().default("service"),
    lifecycle: lifecycle("lifecycle").notNull().default("experimental"),
    ownerTeamId: uuid("owner_team_id"),
    repoUrl: text("repo_url").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUnique: uniqueIndex("services_slug_unique").on(t.slug),
    lifecycleIdx: index("services_lifecycle_idx").on(t.lifecycle),
    ownerIdx: index("services_owner_idx").on(t.ownerTeamId),
  }),
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
