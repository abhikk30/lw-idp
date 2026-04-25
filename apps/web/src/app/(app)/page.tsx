import { Badge } from "@lw-idp/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import Link from "next/link";
import type { ReactNode } from "react";
import { createServerClient } from "../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface ServiceRow {
  id: string;
  slug: string;
  name: string;
  type: string;
  lifecycle: string;
  updatedAt: string;
}

interface ClusterRow {
  id: string;
  slug: string;
  name: string;
  environment: string;
  provider: string;
}

interface DashboardData {
  recentServices: ServiceRow[];
  clusters: ClusterRow[];
  servicesError?: string;
  clustersError?: string;
}

async function loadDashboard(): Promise<DashboardData> {
  const client = await createServerClient();

  const [servicesResult, clustersResult] = await Promise.allSettled([
    client.GET("/services", { params: { query: { limit: 5 } } }),
    client.GET("/clusters", { params: { query: { limit: 50 } } }),
  ]);

  let recentServices: ServiceRow[] = [];
  let servicesError: string | undefined;
  if (servicesResult.status === "fulfilled" && servicesResult.value.data) {
    recentServices = (servicesResult.value.data.items ?? []).map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      type: s.type ?? "service",
      lifecycle: s.lifecycle ?? "experimental",
      updatedAt: s.updatedAt ?? s.createdAt ?? "",
    }));
  } else if (servicesResult.status === "rejected") {
    servicesError = "Could not load services.";
  } else {
    servicesError = "Could not load services.";
  }

  let clusters: ClusterRow[] = [];
  let clustersError: string | undefined;
  if (clustersResult.status === "fulfilled" && clustersResult.value.data) {
    clusters = (clustersResult.value.data.items ?? []).map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      environment: c.environment ?? "dev",
      provider: c.provider ?? "kind",
    }));
  } else if (clustersResult.status === "rejected") {
    clustersError = "Could not load clusters.";
  } else {
    clustersError = "Could not load clusters.";
  }

  const result: DashboardData = { recentServices, clusters };
  if (servicesError !== undefined) {
    result.servicesError = servicesError;
  }
  if (clustersError !== undefined) {
    result.clustersError = clustersError;
  }
  return result;
}

export default async function DashboardPage(): Promise<ReactNode> {
  const data = await loadDashboard();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">Recent activity across your platform.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent services */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Recent services</CardTitle>
              <CardDescription>The last 5 catalog entries</CardDescription>
            </div>
            <Link href="/services" className="text-primary text-sm font-medium hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {data.servicesError ? (
              <p className="text-destructive text-sm">{data.servicesError}</p>
            ) : data.recentServices.length === 0 ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-muted-foreground text-sm">
                  No services yet — register your first one.
                </p>
                <Link
                  href="/services/new"
                  className="text-primary text-sm font-medium hover:underline"
                >
                  Register service →
                </Link>
              </div>
            ) : (
              <ul className="divide-border divide-y">
                {data.recentServices.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <Link
                      href={`/services/${s.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {s.name}
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{s.type}</Badge>
                      <Badge variant={s.lifecycle === "production" ? "default" : "outline"}>
                        {s.lifecycle}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Cluster summary */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Clusters</CardTitle>
              <CardDescription>{data.clusters.length} registered</CardDescription>
            </div>
            <Link href="/clusters" className="text-primary text-sm font-medium hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {data.clustersError ? (
              <p className="text-destructive text-sm">{data.clustersError}</p>
            ) : data.clusters.length === 0 ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-muted-foreground text-sm">
                  No clusters yet — register your first one.
                </p>
                <Link
                  href="/clusters/new"
                  className="text-primary text-sm font-medium hover:underline"
                >
                  Register cluster →
                </Link>
              </div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {data.clusters.slice(0, 6).map((c) => (
                  <li
                    key={c.id}
                    className="border-border flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <Link
                      href={`/clusters/${c.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {c.name}
                    </Link>
                    <Badge
                      variant={
                        c.environment === "prod"
                          ? "default"
                          : c.environment === "stage"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {c.environment}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
