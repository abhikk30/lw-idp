import type { ReactNode } from "react";
import {
  ClustersTable,
  type ClustersTableRow,
} from "../../../components/clusters/clusters-table.client.js";
import { createServerClient } from "../../../lib/api/server.js";

export const dynamic = "force-dynamic";

async function loadClusters(): Promise<ClustersTableRow[]> {
  const client = await createServerClient();
  const { data } = await client.GET("/clusters", { params: { query: { limit: 50 } } });
  return (data?.items ?? []).map(
    (c): ClustersTableRow => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      environment: c.environment ?? "dev",
      region: c.region ?? "",
      provider: c.provider ?? "kind",
      createdAt: c.createdAt ?? "",
    }),
  );
}

export default async function ClustersPage(): Promise<ReactNode> {
  const initialData = await loadClusters();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Clusters</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The Kubernetes clusters lw-idp manages.
        </p>
      </div>
      <ClustersTable initialData={initialData} />
    </div>
  );
}
