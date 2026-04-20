import { asc, eq, isNull } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { JSONCodec, type JetStreamClient } from "nats";

export interface OutboxRow {
  id: string;
  aggregate: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  publishedAt: Date | null;
}

export function outboxTable(name: string) {
  return pgTable(name, {
    id: uuid("id").defaultRandom().primaryKey(),
    aggregate: text("aggregate").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  });
}

export type OutboxTable = ReturnType<typeof outboxTable>;

export interface PublishOutboxOptions {
  // Accept any PostgresJsDatabase schema variant (Record<string, never> | Record<string, unknown>)
  db: PostgresJsDatabase<Record<string, unknown>>;
  js: JetStreamClient;
  table: OutboxTable;
  pollIntervalMs?: number;
  batchSize?: number;
  onError?: (err: unknown) => void;
}

export interface OutboxPublisherHandle {
  stop: () => Promise<void>;
}

export function publishOutbox(opts: PublishOutboxOptions): OutboxPublisherHandle {
  const pollMs = opts.pollIntervalMs ?? 1000;
  const batch = opts.batchSize ?? 100;
  const codec = JSONCodec();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick(): Promise<void> {
    if (stopped) {
      return;
    }
    try {
      const unpublished = await opts.db
        .select()
        .from(opts.table)
        .where(isNull(opts.table.publishedAt))
        .orderBy(asc(opts.table.createdAt))
        .limit(batch);

      for (const row of unpublished) {
        await opts.js.publish(row.eventType, codec.encode(row.payload));
        await opts.db
          .update(opts.table)
          .set({ publishedAt: new Date() })
          .where(eq(opts.table.id, row.id));
      }
    } catch (err) {
      if (opts.onError) {
        opts.onError(err);
      }
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, pollMs);
      }
    }
  }

  void tick();

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  };
}
