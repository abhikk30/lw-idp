import { connect, runMigrations } from "@lw-idp/db";
import { publishOutbox } from "@lw-idp/events";
import { startServer } from "@lw-idp/service-kit";
import { connect as natsConnect } from "nats";
import { loadConfig } from "./config.js";
import { outbox } from "./db/schema/index.js";
import { registerConnectRpc } from "./grpc/plugin.js";

const env = loadConfig();
const db = connect(env.PG_DSN);

if (env.RUN_MIGRATIONS === "1") {
  await runMigrations(db, { migrationsFolder: "src/db/migrations" });
}

const nc = await natsConnect({ servers: env.NATS_URL });
const js = nc.jetstream();
const publisher = publishOutbox({
  db,
  js,
  table: outbox,
  pollIntervalMs: env.OUTBOX_POLL_MS,
  onError: (err) => {
    // eslint-disable-next-line no-console
    console.error("[catalog-svc outbox]", err);
  },
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, async () => {
    try {
      await publisher.stop();
    } catch {
      // ignore
    }
    try {
      await nc.drain();
    } catch {
      // ignore
    }
  });
}

await startServer({
  name: "catalog-svc",
  port: env.PORT,
  register: async (fastify) => {
    await registerConnectRpc(fastify, { db });
  },
});
