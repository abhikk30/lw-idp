import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Inline equivalent of outboxTable("outbox") from @lw-idp/events
// (drizzle-kit cannot traverse workspace packages that use .js ESM imports)
export const outbox = pgTable("outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  aggregate: text("aggregate").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export type OutboxRow = typeof outbox.$inferSelect;
