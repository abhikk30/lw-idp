import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type Db = PostgresJsDatabase;

export function connect(connectionString: string, opts?: { max?: number }): Db {
  const client = postgres(connectionString, { max: opts?.max ?? 10, prepare: false });
  return drizzle(client);
}
