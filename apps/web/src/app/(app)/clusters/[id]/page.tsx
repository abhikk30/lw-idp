import { Badge } from "@lw-idp/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createServerClient } from "../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

// NOTE: cluster delete is intentionally not exposed in the UI for P1.7.
// Spec §7.6 requires platform-admin RBAC for cluster CRUD; revisit in P1.9+
// once RBAC is real and there's a meaningful confirmation/decommission flow.
export default async function ClusterDetailPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/clusters/{id}", { params: { path: { id } } });
  if (!data) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{data.name}</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">{data.slug}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cluster</CardTitle>
            <CardDescription>Connection details and metadata.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Environment">
              <Badge
                variant={
                  data.environment === "prod"
                    ? "default"
                    : data.environment === "stage"
                      ? "secondary"
                      : "outline"
                }
              >
                {data.environment ?? "dev"}
              </Badge>
            </Field>
            <Field label="Region">
              <span className="text-sm">{data.region ?? "—"}</span>
            </Field>
            <Field label="Provider">
              <Badge variant="secondary">{data.provider}</Badge>
            </Field>
            {data.apiEndpoint ? (
              <Field label="API endpoint">
                <code className="text-muted-foreground break-all text-xs">{data.apiEndpoint}</code>
              </Field>
            ) : null}
            {data.createdAt ? (
              <Field label="Registered">
                <span className="text-muted-foreground text-sm">
                  {new Date(data.createdAt).toLocaleString()}
                </span>
              </Field>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      <div>{children}</div>
    </div>
  );
}
