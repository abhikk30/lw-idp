import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { clusters } from "./clusters.js";

export const clusterTags = pgTable(
  "cluster_tags",
  {
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clusterId, t.tag] }),
    tagIdx: index("cluster_tags_tag_idx").on(t.tag),
  }),
);

export type ClusterTag = typeof clusterTags.$inferSelect;
