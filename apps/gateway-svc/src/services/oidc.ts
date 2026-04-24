import { createHash, randomBytes } from "node:crypto";

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

export function createPkcePair(): PkcePair {
  // 32 random bytes → 43-char base64url (no padding)
  const verifierBytes = randomBytes(32);
  const verifier = verifierBytes.toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" };
}

export interface BuildAuthorizeUrlInput {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  nonce?: string;
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const base = input.issuer.replace(/\/$/, "");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: input.scopes.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  if (input.nonce) {
    params.set("nonce", input.nonce);
  }
  return `${base}/auth?${params.toString()}`;
}

export interface ExchangeCodeForTokensInput {
  issuer: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface TokenResponse {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
}

export async function exchangeCodeForTokens(
  input: ExchangeCodeForTokensInput,
): Promise<TokenResponse> {
  const base = input.issuer.replace(/\/$/, "");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.codeVerifier,
  });
  const res = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token exchange failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    id_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
  };
  const out: TokenResponse = {
    accessToken: json.access_token,
    idToken: json.id_token,
    tokenType: json.token_type,
    expiresIn: json.expires_in,
  };
  if (json.refresh_token) {
    out.refreshToken = json.refresh_token;
  }
  return out;
}
