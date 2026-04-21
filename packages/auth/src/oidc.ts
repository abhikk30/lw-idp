import { type JWTPayload, type RemoteJWKSetOptions, createRemoteJWKSet, jwtVerify } from "jose";

export interface OidcVerifierOptions {
  issuer: string;
  audience: string | string[];
  /** Path on the issuer where JWKS lives. Default `/.well-known/jwks.json`. Dex exposes `/keys`. */
  jwksPath?: string;
  /** How often to refetch JWKS when a kid is not found, in ms. Default 5 minutes. */
  cooldownDurationMs?: number;
}

export interface VerifiedIdTokenClaims extends JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  groups?: string[];
  iss?: string;
  aud?: string | string[];
}

export type OidcVerifier = (token: string) => Promise<VerifiedIdTokenClaims>;

export function createOidcVerifier(opts: OidcVerifierOptions): OidcVerifier {
  const jwksPath = opts.jwksPath ?? "/.well-known/jwks.json";
  // Ensure issuer has no trailing slash before appending the path
  const baseIssuer = opts.issuer.replace(/\/$/, "");
  const jwksUrl = new URL(`${baseIssuer}${jwksPath}`);
  const jwksOptions: RemoteJWKSetOptions = {
    cooldownDuration: opts.cooldownDurationMs ?? 5 * 60_000,
  };
  const jwks = createRemoteJWKSet(jwksUrl, jwksOptions);

  return async function verify(token: string): Promise<VerifiedIdTokenClaims> {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: opts.issuer,
      audience: opts.audience,
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new Error("id_token missing sub");
    }
    return payload as VerifiedIdTokenClaims;
  };
}
