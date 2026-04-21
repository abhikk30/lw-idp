import { connect, runMigrations } from "@lw-idp/db";

async function main(): Promise<void> {
  const dsn = process.env.PG_DSN;
  if (!dsn) {
    throw new Error("PG_DSN is required");
  }
  const db = connect(dsn);
  await runMigrations(db, { migrationsFolder: "src/db/migrations" });
  // eslint-disable-next-line no-console
  console.info("migrations applied");
  process.exit(0);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("migration failed:", err);
  process.exit(1);
});
