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
import { LogsPanel } from "../../../../components/observability/logs-panel.client.js";
import { MetricsSparkline } from "../../../../components/observability/metrics-sparkline.client.js";
import { PodStatusStrip } from "../../../../components/observability/pod-status-strip.client.js";
import { TeamName } from "../../../../components/team-name.client.js";
import { createServerClient } from "../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ServiceOverviewPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/services/{id}", { params: { path: { id } } });
  if (!data) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <PodStatusStrip serviceSlug={data.slug} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricsSparkline serviceSlug={data.slug} panel="req_rate" label="Request rate" />
        <MetricsSparkline serviceSlug={data.slug} panel="error_rate" label="Error rate" />
        <MetricsSparkline serviceSlug={data.slug} panel="p95_latency" label="p95 latency" />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LogsPanel serviceSlug={data.slug} />
        {/* TracesPanel slot — Task F2 will fill this */}
        <div />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
            <CardDescription>
              {data.description ?? <span className="italic">No description.</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Type">
              <Badge variant="secondary">{data.type ?? "service"}</Badge>
            </Field>
            <Field label="Lifecycle">
              <Badge variant={data.lifecycle === "production" ? "default" : "outline"}>
                {data.lifecycle ?? "experimental"}
              </Badge>
            </Field>
            <Field label="Owner team">
              {data.ownerTeamId ? (
                <TeamName id={data.ownerTeamId} />
              ) : (
                <span className="text-muted-foreground text-sm italic">unowned</span>
              )}
            </Field>
            {data.repoUrl ? (
              <Field label="Repository">
                <a
                  className="text-primary text-sm hover:underline"
                  href={data.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {data.repoUrl}
                </a>
              </Field>
            ) : null}
            {(data.tags?.length ?? 0) > 0 ? (
              <Field label="Tags">
                <div className="flex flex-wrap gap-1">
                  {(data.tags ?? []).map((t) => (
                    <Badge key={t} variant="outline">
                      {t}
                    </Badge>
                  ))}
                </div>
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
