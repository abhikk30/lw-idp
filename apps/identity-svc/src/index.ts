import { createOidcVerifier } from "@lw-idp/auth";
import { connect } from "@lw-idp/db";
import { startServer } from "@lw-idp/service-kit";
import { registerConnectRpc } from "./grpc/plugin.js";

const port = Number(process.env.PORT ?? 4001);
const pgDsn = process.env.PG_DSN ?? "postgresql://postgres:postgres@localhost:5432/identity";
const dexIssuer = process.env.DEX_ISSUER ?? "https://dex.lw-idp.local";
const dexAudience = process.env.DEX_AUDIENCE ?? "lw-idp-gateway";

const db = connect(pgDsn);
const verifier = createOidcVerifier({
  issuer: dexIssuer,
  audience: dexAudience,
  jwksPath: "/keys",
});

await startServer({
  name: "identity-svc",
  port,
  register: async (fastify) => {
    await registerConnectRpc(fastify, { db, verifier });
  },
});
