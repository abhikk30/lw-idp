/**
 * /auth/login — public, server-rendered sign-in page.
 *
 * Note on routing:
 *   The web app does NOT own the OIDC dance. /auth/login (this page) just
 *   renders a "Sign in with GitHub" button whose server action issues a
 *   same-origin redirect to /auth/login. Through the portal.lw-idp.local
 *   ingress (post-G2), /auth/* path-routes to gateway-svc, NOT back to web.
 *   gateway-svc's /auth/login (P1.5) starts the actual OIDC handshake and
 *   sets the lw-sid cookie on the redirect response.
 *
 *   No /auth/callback route on web by design — the OIDC redirect URI is
 *   registered as portal.lw-idp.local/auth/callback and ingress sends that
 *   to gateway-svc. The cookie is set by the gateway response.
 *
 * Local `next dev` caveat:
 *   Without the kind ingress, /auth/login would loop back to this page.
 *   For manual local testing, seed a session directly in Dragonfly (the
 *   same trick the F4 Playwright golden-path uses) — bypasses Dex.
 */
import { Button } from "@lw-idp/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ redirect?: string }>;
}

/**
 * Returns true iff `value` is a safe same-origin redirect target.
 * Allows: leading-slash absolute paths only.
 * Rejects: absolute URLs, protocol-relative URLs (//evil.com), bare paths,
 *   and anything that doesn't start with a single `/`.
 *
 * Defense-in-depth against open-redirect: gateway-svc currently calls
 * `reply.redirect(redirectAfter)` without validation, so we refuse to
 * forward anything that isn't a same-origin path. The deeper fix lives
 * on gateway-svc (filed as P1.8 IMP); this is web's contribution to
 * not creating the vector in the first place.
 */
function isSafeRedirect(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  // Reject protocol-relative URLs first (//evil.com)
  if (value.startsWith("//")) {
    return false;
  }
  // Reject absolute URLs (http:, https:, javascript:, data:, etc.)
  if (/^[a-z][a-z0-9+\-.]*:/i.test(value)) {
    return false;
  }
  // Must start with `/` for an absolute same-origin path.
  if (!value.startsWith("/")) {
    return false;
  }
  return true;
}

async function startLogin(formData: FormData): Promise<void> {
  "use server";
  const raw = formData.get("redirect");
  const redirectAfter = typeof raw === "string" && isSafeRedirect(raw) ? raw : null;
  // Same-origin redirect to /auth/login. Through portal.lw-idp.local ingress,
  // /auth/* routes to gateway-svc (post-G2). The `&via=web` is a no-op
  // tracer so we can tell button-clicks from direct deep-links in logs.
  const target =
    redirectAfter !== null
      ? `/auth/login?redirect=${encodeURIComponent(redirectAfter)}&via=web`
      : "/auth/login?via=web";
  redirect(target);
}

export default async function LoginPage({ searchParams }: PageProps): Promise<React.ReactNode> {
  const { redirect: redirectAfter } = await searchParams;
  const safeRedirect =
    typeof redirectAfter === "string" && isSafeRedirect(redirectAfter) ? redirectAfter : null;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            <h1>Welcome to lw-idp</h1>
          </CardTitle>
          <CardDescription>Sign in with your GitHub account to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={startLogin} className="flex flex-col gap-4">
            {safeRedirect !== null ? (
              <input type="hidden" name="redirect" value={safeRedirect} />
            ) : null}
            <Button type="submit" size="lg" className="w-full">
              Sign in with GitHub
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
