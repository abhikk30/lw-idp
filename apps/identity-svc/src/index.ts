import { createOidcVerifier } from "@lw-idp/auth";
import { connect, runMigrations } from "@lw-idp/db";
import { publishOutbox } from "@lw-idp/events";
import { startServer } from "@lw-idp/service-kit";
import { connect as natsConnect } from "nats";
import { loadConfig } from "./config.js";
import { outbox } from "./db/schema/index.js";
import { registerConnectRpc } from "./grpc/plugin.js";
import { registerAuthRoutes } from "./http/auth.js";
import { createStateStore } from "./services/oidc.js";

const env = loadConfig();

const db = connect(env.PG_DSN);

if (env.RUN_MIGRATIONS === "1") {
  await runMigrations(db, { migrationsFolder: "src/db/migrations" });
}

const verifier = createOidcVerifier({
  issuer: env.DEX_ISSUER,
  audience: env.DEX_AUDIENCE,
  jwksPath: "/keys",
});
const stateStore = createStateStore({ ttlMs: 10 * 60_000 });

const nc = await natsConnect({ servers: env.NATS_URL });
const js = nc.jetstream();
const publisher = publishOutbox({
  db,
  js,
  table: outbox,
  pollIntervalMs: env.OUTBOX_POLL_MS,
  onError: (err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[outbox]", err);
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
    // service-kit's own signal handler will also fire and close Fastify.
  });
}

await startServer({
  name: "identity-svc",
  port: env.PORT,
  register: async (fastify) => {
    await registerConnectRpc(fastify, { db, verifier });
    await registerAuthRoutes(fastify, {
      db,
      verifier,
      stateStore,
      oidc: {
        issuer: env.DEX_ISSUER,
        clientId: env.DEX_CLIENT_ID,
        clientSecret: env.DEX_CLIENT_SECRET,
        redirectUri: env.GATEWAY_REDIRECT_URI,
        scopes: ["openid", "email", "profile"],
      },
      cookie: {
        secure: env.SESSION_SECURE,
        maxAgeSeconds: 8 * 60 * 60,
      },
    });
  },
});
