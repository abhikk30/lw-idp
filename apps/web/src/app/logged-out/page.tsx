import { Button } from "@lw-idp/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "Signed out — lw-idp",
};

/**
 * /logged-out — landing page after the gateway clears the session cookie.
 *
 * Reached via the 303 redirect from gateway-svc /auth/logout. Renders a
 * confirmation message + a single sign-in CTA so the user has explicit
 * feedback that their session ended (the previous 204 response left them
 * silently on whatever page they were viewing — the cookie was dropped but
 * the UI didn't change).
 *
 * Hosted at `/logged-out` (not `/auth/logout`) because the ingress routes
 * `/auth/*` to gateway-svc — anything under that prefix would 404 against
 * the gateway. The path is added to web middleware's `PUBLIC_PREFIXES` so
 * it loads without a session.
 */
export default function LoggedOutPage(): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Signed out</CardTitle>
          <CardDescription>Your session has ended. Sign in again to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/auth/login">Sign in with GitHub</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
