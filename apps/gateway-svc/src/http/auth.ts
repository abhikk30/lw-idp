import {
  type OidcVerifier,
  type SessionRecord,
  type SessionStore,
  isSafeRedirect,
  newSessionId,
  parseSessionCookie,
  serializeSessionCookie,
} from "@lw-idp/auth";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { ulid } from "ulid";
import type { IdentityClient } from "../clients/identity.js";
import { buildAuthorizeUrl, createPkcePair, exchangeCodeForTokens } from "../services/oidc.js";
import type { StateStore } from "../services/state-store.js";

export interface AuthPluginOptions {
  verifier: OidcVerifier;
  stateStore: StateStore;
  sessionStore: SessionStore;
  identityClient: IdentityClient;
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
    domain?: string;
  };
  sessionTtlSeconds: number;
  defaultRedirect?: string;
}

const authPluginFn: FastifyPluginAsync<AuthPluginOptions> = async (
  fastify: FastifyInstance,
  opts: AuthPluginOptions,
) => {
  fastify.get<{ Querystring: { redirect?: string } }>("/auth/login", async (req, reply) => {
    const { verifier: codeVerifier, challenge } = createPkcePair();
    const state = ulid();
    const entry: { codeVerifier: string; redirectAfter?: string } = { codeVerifier };
    if (req.query.redirect) {
      entry.redirectAfter = req.query.redirect;
    }
    await opts.stateStore.put(state, entry);
    const authorizeUrl = buildAuthorizeUrl({
      issuer: opts.oidc.issuer,
      clientId: opts.oidc.clientId,
      redirectUri: opts.oidc.redirectUri,
      scopes: opts.oidc.scopes,
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
        return reply.code(400).send({ code: "bad_request", message: "missing code or state" });
      }
      const entry = await opts.stateStore.take(state);
      if (!entry) {
        return reply.code(400).send({ code: "bad_request", message: "invalid or expired state" });
      }

      let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
      try {
        tokens = await exchangeCodeForTokens({
          issuer: opts.oidc.issuer,
          clientId: opts.oidc.clientId,
          clientSecret: opts.oidc.clientSecret,
          code,
          redirectUri: opts.oidc.redirectUri,
          codeVerifier: entry.codeVerifier,
        });
      } catch (err) {
        fastify.log.warn({ err }, "token exchange failed");
        return reply.code(401).send({ code: "unauthorized", message: "token exchange failed" });
      }

      // Verify the id_token via JWKS
      try {
        await opts.verifier(tokens.idToken);
      } catch (err) {
        fastify.log.warn({ err }, "id_token verification failed");
        return reply
          .code(401)
          .send({ code: "unauthorized", message: "id_token verification failed" });
      }

      // Call identity-svc.VerifyToken via gRPC — this upserts the user and returns { user, teams }
      let verifyResult: Awaited<ReturnType<IdentityClient["verifyToken"]>>;
      try {
        verifyResult = await opts.identityClient.verifyToken({ idToken: tokens.idToken });
      } catch (err) {
        fastify.log.error({ err }, "identity-svc VerifyToken failed");
        return reply
          .code(502)
          .send({ code: "unavailable", message: "identity service unavailable" });
      }

      if (!verifyResult.user) {
        return reply.code(500).send({ code: "internal", message: "identity returned no user" });
      }

      const user = verifyResult.user;
      const teams = verifyResult.teams ?? [];

      const sid = newSessionId();
      const sessionRecord: SessionRecord = {
        userId: user.id,
        subject: user.subject,
        email: user.email,
        displayName: user.displayName,
        teams: teams.map((t) => ({ id: t.id, slug: t.slug, name: t.name })),
        createdAt: new Date().toISOString(),
      };
      if (user.avatarUrl) {
        sessionRecord.avatarUrl = user.avatarUrl;
      }
      // Persist the id_token for the gateway argocd proxy plugin (P2.0 task
      // C2): Dex `trustedPeers` makes the same token valid for both
      // `lw-idp-gateway` and `argocd` audiences, so we forward this as the
      // bearer to Argo CD's REST API on every proxied call.
      sessionRecord.idToken = tokens.idToken;

      await opts.sessionStore.set(sid, sessionRecord, { ttlSeconds: opts.sessionTtlSeconds });

      const cookieHeader = serializeSessionCookie(sid, {
        secure: opts.cookie.secure,
        maxAgeSeconds: opts.cookie.maxAgeSeconds,
        ...(opts.cookie.domain !== undefined ? { domain: opts.cookie.domain } : {}),
      });
      reply.header("set-cookie", cookieHeader);

      const requestedRedirect = entry.redirectAfter;
      const redirectTo =
        requestedRedirect && isSafeRedirect(requestedRedirect)
          ? requestedRedirect
          : (opts.defaultRedirect ?? "/");
      return reply.redirect(redirectTo, 302);
    },
  );

  fastify.post("/auth/logout", async (req, reply) => {
    const sid = parseSessionCookie(req.headers.cookie ?? undefined);
    if (sid) {
      await opts.sessionStore.delete(sid);
    }
    // Clear cookie by setting a past Max-Age=0
    const clear = serializeSessionCookie("", {
      secure: opts.cookie.secure,
      maxAgeSeconds: 0,
      ...(opts.cookie.domain !== undefined ? { domain: opts.cookie.domain } : {}),
    });
    reply.header("set-cookie", clear);
    return reply.code(204).send();
  });
};

export const authPlugin = fp(authPluginFn, { name: "lw-idp-auth" });
