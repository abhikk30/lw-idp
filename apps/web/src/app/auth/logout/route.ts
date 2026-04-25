/**
 * /auth/logout — POST-only route handler.
 *
 * Forwards the user's lw-sid cookie to gateway-svc /auth/logout (best-effort
 * upstream invalidation in Dragonfly), then clears the cookie locally and
 * 303-redirects the browser to /auth/login. We always clear the cookie even
 * when the upstream call fails (network error, gateway down) — the user
 * should never get stuck "logged in" on the client.
 *
 * Note: post-G2, ingress routes /auth/* to gateway-svc, so this handler is
 * only reachable in scenarios where web owns /auth/logout (pre-G2 or local
 * dev). It's still useful as a defense-in-depth path for cookie clearing.
 */
import { type NextRequest, NextResponse } from "next/server";

function gatewayBaseUrl(): string {
  // Read at call-time (not module-load) so tests can stub the env var.
  // Strip trailing /api/v1 if present — gateway's /auth/* lives at the root.
  return (
    process.env.GATEWAY_INTERNAL_URL?.replace(/\/api\/v1$/, "") ??
    "http://gateway-svc.lw-idp.svc.cluster.local"
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookie = req.headers.get("cookie") ?? "";
  // Best-effort upstream logout to invalidate session in Dragonfly.
  try {
    await fetch(`${gatewayBaseUrl()}/auth/logout`, {
      method: "POST",
      headers: { cookie },
    });
  } catch {
    // ignore — we still clear the local cookie below
  }

  // Clear lw-sid in the response so the browser drops the session.
  const res = NextResponse.redirect(new URL("/auth/login", req.url), { status: 303 });
  res.cookies.set("lw-sid", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
