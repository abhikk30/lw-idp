import { Button } from "@lw-idp/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import type { ReactNode } from "react";

export default function ApiTokensPage(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">API tokens</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Personal access tokens for programmatic access to lw-idp.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>No tokens yet</CardTitle>
          <CardDescription>
            Token generation lands in Plan 3 alongside Jenkins integration. For now, cookie-based
            session auth is the only access path for the platform UI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button disabled>Generate token (coming P3)</Button>
        </CardContent>
      </Card>
    </div>
  );
}
