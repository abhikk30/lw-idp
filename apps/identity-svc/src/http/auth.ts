import type { OidcVerifier, VerifiedIdTokenClaims } from "@lw-idp/auth";
import { newSessionId, serializeSessionCookie } from "@lw-idp/auth";
import type { BuildServerOptions } from "@lw-idp/service-kit";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { ulid } from "ulid";
import { userSessions } from "../db/schema/index.js";
import {
  type StateStore,
  type TokenResponse,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCodeForTokens,
} from "../services/oidc.js";
import { upsertUserBySubject } from "../services/users.js";

// Extract FastifyInstance type from service-kit's register callback signature
type RegisterFn = NonNullable<BuildServerOptions["register"]>;
type FastifyArg = Parameters<RegisterFn>[0];

export interface AuthRouteDeps {
  db: PostgresJsDatabase;
  verifier: OidcVerifier;
  stateStore: StateStore;
  oidc: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
  };
  cookie: {
    secure: boolean;
    maxAgeSeconds: number;
  };
}

export async function registerAuthRoutes(fastify: FastifyArg, deps: AuthRouteDeps): Promise<void> {
  fastify.get<{ Querystring: { redirect?: string } }>("/auth/login", async (req, reply) => {
    const { verifier: codeVerifier, challenge } = createPkcePair();
    const state = ulid();
    deps.stateStore.put(state, {
      codeVerifier,
      ...(req.query.redirect ? { redirectAfter: req.query.redirect } : {}),
    });
    const authorizeUrl = buildAuthorizeUrl({
      issuer: deps.oidc.issuer,
      clientId: deps.oidc.clientId,
      redirectUri: deps.oidc.redirectUri,
      scopes: deps.oidc.scopes,
      state,
      codeChallenge: challenge,
    });
    return reply.redirect(authorizeUrl, 302);
  });

  fastify.get<{ Querystring: { code?: string; state?: string } }>(
    "/auth/callback",
    async (req, reply) => {
      const { code, state } = req.query;
      if (!code || !state) {
        return reply.code(400).send({ error: "missing code or state" });
      }
      const entry = deps.stateStore.take(state);
      if (!entry) {
        return reply.code(400).send({ error: "invalid or expired state" });
      }

      let tokens: TokenResponse;
      try {
        tokens = await exchangeCodeForTokens({
          issuer: deps.oidc.issuer,
          clientId: deps.oidc.clientId,
          clientSecret: deps.oidc.clientSecret,
          code,
          redirectUri: deps.oidc.redirectUri,
          codeVerifier: entry.codeVerifier,
        });
      } catch (err) {
        fastify.log.warn({ err }, "token exchange failed");
        return reply.code(401).send({ error: "token exchange failed" });
      }

      let claims: VerifiedIdTokenClaims;
      try {
        claims = await deps.verifier(tokens.idToken);
      } catch (err) {
        fastify.log.warn({ err }, "id_token verification failed");
        return reply.code(401).send({ error: "id_token verification failed" });
      }

      const picture = (claims as VerifiedIdTokenClaims & { picture?: string }).picture;
      const user = await upsertUserBySubject(deps.db, {
        subject: claims.sub,
        email: claims.email ?? `${claims.sub}@unknown`,
        ...(claims.name !== undefined ? { displayName: claims.name } : {}),
        ...(picture !== undefined ? { avatarUrl: picture } : {}),
      });

      const sid = newSessionId();
      const expiresAt = new Date(Date.now() + deps.cookie.maxAgeSeconds * 1000);
      try {
        await deps.db.insert(userSessions).values({
          id: sid,
          userId: user.id,
          expiresAt,
        });
      } catch (err) {
        fastify.log.warn({ err }, "failed to persist session row; proceeding with cookie only");
      }

      const cookieHeader = serializeSessionCookie(sid, {
        secure: deps.cookie.secure,
        maxAgeSeconds: deps.cookie.maxAgeSeconds,
      });
      reply.header("set-cookie", cookieHeader);
      const redirectTo = entry.redirectAfter ?? "/";
      return reply.redirect(redirectTo, 302);
    },
  );
}
