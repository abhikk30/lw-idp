import type { ReactNode } from "react";
import {
  ServicesTable,
  type ServicesTableRow,
} from "../../../components/services/services-table.client.js";
import { createServerClient } from "../../../lib/api/server.js";

export const dynamic = "force-dynamic";

async function loadServices(): Promise<ServicesTableRow[]> {
  const client = await createServerClient();
  const { data } = await client.GET("/services", { params: { query: { limit: 50 } } });
  return (data?.items ?? []).map(
    (s): ServicesTableRow => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      type: s.type ?? "service",
      lifecycle: s.lifecycle ?? "experimental",
      ownerTeamId: s.ownerTeamId ?? "",
      updatedAt: s.updatedAt ?? s.createdAt ?? "",
    }),
  );
}

export default async function ServicesPage(): Promise<ReactNode> {
  const initialData = await loadServices();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Services</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The catalog — every service, library, and job your platform owns.
        </p>
      </div>
      <ServicesTable initialData={initialData} />
    </div>
  );
}
