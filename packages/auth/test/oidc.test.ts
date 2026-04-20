import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type JWK, type KeyLike, SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOidcVerifier } from "../src/index.js";

describe("createOidcVerifier", () => {
  let server: Server;
  let port: number;
  let privateKey: KeyLike;
  let publicJwk: JWK;
  let issuer: string;

  beforeAll(async () => {
    const kp = await generateKeyPair("RS256");
    privateKey = kp.privateKey;
    publicJwk = { ...(await exportJWK(kp.publicKey)), alg: "RS256", kid: "test-kid", use: "sig" };

    server = createServer((req, res) => {
      if (req.url === "/keys") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ keys: [publicJwk] }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as AddressInfo;
    port = addr.port;
    issuer = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function sign(claims: Record<string, unknown>): Promise<string> {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
      .setIssuer(issuer)
      .setAudience((claims.aud as string) ?? "lw-idp-gateway")
      .setSubject((claims.sub as string) ?? "gh|42")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }

  it("verifies a token with matching issuer + audience", async () => {
    const verify = createOidcVerifier({
      issuer,
      audience: "lw-idp-gateway",
      jwksPath: "/keys",
    });
    const token = await sign({ sub: "gh|1", email: "a@b.com", name: "Alice" });
    const claims = await verify(token);
    expect(claims.sub).toBe("gh|1");
    expect(claims.email).toBe("a@b.com");
    expect(claims.name).toBe("Alice");
  });

  it("rejects a token with a different audience", async () => {
    const verify = createOidcVerifier({
      issuer,
      audience: "lw-idp-gateway",
      jwksPath: "/keys",
    });
    const token = await sign({ sub: "gh|1", aud: "different-audience" });
    await expect(verify(token)).rejects.toThrow();
  });

  it("rejects a token with a different issuer", async () => {
    const verify = createOidcVerifier({
      issuer: `http://127.0.0.1:${port + 1}`, // wrong issuer
      audience: "lw-idp-gateway",
      jwksPath: "/keys",
    });
    const token = await sign({ sub: "gh|1" });
    await expect(verify(token)).rejects.toThrow();
  });

  it("rejects a tampered token", async () => {
    const verify = createOidcVerifier({
      issuer,
      audience: "lw-idp-gateway",
      jwksPath: "/keys",
    });
    const token = await sign({ sub: "gh|1" });
    const tampered = `${token.slice(0, -4)}XXXX`;
    await expect(verify(tampered)).rejects.toThrow();
  });
});
