import { createOidcVerifier } from "@lw-idp/auth";
import { connect } from "@lw-idp/db";
import { startServer } from "@lw-idp/service-kit";
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
