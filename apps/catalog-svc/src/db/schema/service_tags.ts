import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { services } from "./services.js";

export const serviceTags = pgTable(
  "service_tags",
  {
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.serviceId, t.tag] }),
    tagIdx: index("service_tags_tag_idx").on(t.tag),
  }),
);

export type ServiceTag = typeof serviceTags.$inferSelect;
