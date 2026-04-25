import { type NextRequest, NextResponse } from "next/server";

/**
 * Public path prefixes that bypass session enforcement.
 * /auth/* — login flow itself (otherwise we'd loop)
 * /api/healthz, /api/readyz — k8s probes
 * /_next, /favicon — Next/asset routes
 * /mock-* — explicit dev/MSW endpoints (not present in prod build)
 */
const PUBLIC_PREFIXES = ["/auth/", "/api/healthz", "/api/readyz", "/_next/", "/favicon", "/mock-"];

const SESSION_COOKIE = "lw-sid";

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Bypass public prefixes.
  if (PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  if (sid) {
    return NextResponse.next();
  }

  // Unauth → redirect to /auth/login with intended-target preserved.
  const loginUrl = new URL("/auth/login", req.url);
  if (pathname !== "/" && pathname !== "/auth/login") {
    loginUrl.searchParams.set("redirect", pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(loginUrl);
}

/**
 * Matcher: run middleware on everything except _next assets and the explicit
 * api probes, which the function above also short-circuits. The matcher is
 * a coarser net; the function's PUBLIC_PREFIXES check is the real gate.
 */
export const config = {
  matcher: [
    /*
     * Match all paths except:
     *  - /_next/static (CSS/JS chunks)
     *  - /_next/image (next/image)
     *  - /favicon.ico
     *  - any file with an extension (e.g., /robots.txt)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
