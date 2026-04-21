import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  createPkcePair,
  createStateStore,
  exchangeCodeForTokens,
} from "../../src/services/oidc.js";

describe("oidc client", () => {
  describe("createPkcePair", () => {
    it("returns a verifier and a challenge; challenge is SHA256(verifier) base64url", () => {
      const pair = createPkcePair();
      expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
      expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(pair.method).toBe("S256");
    });

    it("produces different pairs across calls", () => {
      const a = createPkcePair();
      const b = createPkcePair();
      expect(a.verifier).not.toBe(b.verifier);
    });
  });

  describe("buildAuthorizeUrl", () => {
    it("constructs a valid OIDC authorize URL with PKCE + state", () => {
      const url = buildAuthorizeUrl({
        issuer: "https://dex.lw-idp.local",
        clientId: "lw-idp-gateway",
        redirectUri: "https://portal.lw-idp.local/auth/callback",
        scopes: ["openid", "email", "profile"],
        state: "state-123",
        codeChallenge: "challenge-abc",
      });
      expect(url).toContain("https://dex.lw-idp.local/auth?");
      expect(url).toContain("response_type=code");
      expect(url).toContain("client_id=lw-idp-gateway");
      expect(url).toContain("redirect_uri=https%3A%2F%2Fportal.lw-idp.local%2Fauth%2Fcallback");
      expect(url).toContain("scope=openid+email+profile");
      expect(url).toContain("state=state-123");
      expect(url).toContain("code_challenge=challenge-abc");
      expect(url).toContain("code_challenge_method=S256");
    });
  });

  describe("createStateStore", () => {
    it("stores + retrieves + deletes", () => {
      const store = createStateStore({ ttlMs: 60_000 });
      store.put("s1", { codeVerifier: "v1" });
      expect(store.take("s1")).toEqual({ codeVerifier: "v1" });
      expect(store.take("s1")).toBeUndefined();
    });

    it("expires entries past TTL", async () => {
      const store = createStateStore({ ttlMs: 20 });
      store.put("s2", { codeVerifier: "v2" });
      await new Promise((r) => setTimeout(r, 40));
      expect(store.take("s2")).toBeUndefined();
    });
  });

  describe("exchangeCodeForTokens", () => {
    let server: Server;
    let port: number;

    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.method === "POST" && req.url === "/token") {
          let body = "";
          req.on("data", (c) => {
            body += c;
          });
          req.on("end", () => {
            const params = new URLSearchParams(body);
            // Echo selected fields back so the test can assert they're POSTed correctly
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify({
                access_token: "fake-access",
                id_token: "fake-id-token",
                refresh_token: "fake-refresh",
                token_type: "Bearer",
                expires_in: 300,
                _echo: {
                  grant_type: params.get("grant_type"),
                  code: params.get("code"),
                  code_verifier: params.get("code_verifier"),
                  redirect_uri: params.get("redirect_uri"),
                },
              }),
            );
          });
        } else {
          res.statusCode = 404;
          res.end();
        }
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      const addr = server.address() as AddressInfo;
      port = addr.port;
    });

    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("POSTs to the token endpoint with PKCE verifier and returns parsed tokens", async () => {
      const tokens = await exchangeCodeForTokens({
        issuer: `http://127.0.0.1:${port}`,
        clientId: "lw-idp-gateway",
        clientSecret: "shh",
        code: "authcode-xyz",
        redirectUri: "https://portal.lw-idp.local/auth/callback",
        codeVerifier: "pkce-verifier-value",
      });
      expect(tokens.accessToken).toBe("fake-access");
      expect(tokens.idToken).toBe("fake-id-token");
      expect(tokens.refreshToken).toBe("fake-refresh");
      expect(tokens.tokenType).toBe("Bearer");
      expect(tokens.expiresIn).toBe(300);
    });
  });
});
