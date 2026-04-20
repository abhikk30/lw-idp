import { createOidcVerifier } from "@lw-idp/auth";
import { connect } from "@lw-idp/db";
import { publishOutbox } from "@lw-idp/events";
import { startServer } from "@lw-idp/service-kit";
import { connect as natsConnect } from "nats";
import { outbox } from "./db/schema/index.js";
import { registerConnectRpc } from "./grpc/plugin.js";
import { registerAuthRoutes } from "./http/auth.js";
import { createStateStore } from "./services/oidc.js";

const port = Number(process.env.PORT ?? 4001);
const pgDsn = process.env.PG_DSN ?? "postgresql://postgres:postgres@localhost:5432/identity";
const dexIssuer = process.env.DEX_ISSUER ?? "https://dex.lw-idp.local";
const dexAudience = process.env.DEX_AUDIENCE ?? "lw-idp-gateway";
const dexClientId = process.env.DEX_CLIENT_ID ?? "lw-idp-gateway";
const dexClientSecret = process.env.DEX_CLIENT_SECRET ?? "devnotreal";
const redirectUri =
  process.env.GATEWAY_REDIRECT_URI ?? "http://identity-svc.lw-idp.svc.cluster.local/auth/callback";
const sessionSecure = (process.env.SESSION_SECURE ?? "false") === "true";

const db = connect(pgDsn);
const verifier = createOidcVerifier({
  issuer: dexIssuer,
  audience: dexAudience,
  jwksPath: "/keys",
});
const stateStore = createStateStore({ ttlMs: 10 * 60_000 });

const natsUrl = process.env.NATS_URL ?? "nats://nats.nats-system.svc.cluster.local:4222";

const nc = await natsConnect({ servers: natsUrl });
const js = nc.jetstream();
const publisher = publishOutbox({
  db,
  js,
  table: outbox,
  pollIntervalMs: Number(process.env.OUTBOX_POLL_MS ?? 500),
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
  port,
  register: async (fastify) => {
    await registerConnectRpc(fastify, { db, verifier });
    await registerAuthRoutes(fastify, {
      db,
      verifier,
      stateStore,
      oidc: {
        issuer: dexIssuer,
        clientId: dexClientId,
        clientSecret: dexClientSecret,
        redirectUri,
        scopes: ["openid", "email", "profile"],
      },
      cookie: {
        secure: sessionSecure,
        maxAgeSeconds: 8 * 60 * 60,
      },
    });
  },
});
