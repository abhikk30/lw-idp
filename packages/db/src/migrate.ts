import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Db } from "./client.js";

export interface MigrateOptions {
  migrationsFolder: string;
  migrationsTable?: string;
}

export async function runMigrations(db: Db, opts: MigrateOptions): Promise<void> {
  await migrate(db, {
    migrationsFolder: opts.migrationsFolder,
    migrationsTable: opts.migrationsTable ?? "drizzle_migrations",
  });
}
