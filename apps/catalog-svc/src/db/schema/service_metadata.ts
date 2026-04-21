import { jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { services } from "./services.js";

export const serviceMetadata = pgTable(
  "service_metadata",
  {
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueJson: jsonb("value_json").$type<unknown>().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.serviceId, t.key] }),
  }),
);
