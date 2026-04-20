import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.PG_DSN ?? "postgresql://postgres:postgres@localhost:5432/identity",
  },
  verbose: true,
  strict: true,
});
