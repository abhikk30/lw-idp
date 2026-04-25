import type { ReactNode } from "react";
import { ServiceTabs } from "../../../../components/services/service-tabs.client.js";
import { createServerClient } from "../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface PageProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

async function loadHeader(id: string): Promise<{ name: string; slug: string } | undefined> {
  const client = await createServerClient();
  const { data } = await client.GET("/services/{id}", { params: { path: { id } } });
  if (!data) {
    return undefined;
  }
  return { name: data.name, slug: data.slug };
}

export default async function ServiceDetailLayout({
  children,
  params,
}: PageProps): Promise<ReactNode> {
  const { id } = await params;
  const header = await loadHeader(id);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{header?.name ?? "Service"}</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">{header?.slug ?? id}</p>
      </div>
      <ServiceTabs id={id} />
      <div>{children}</div>
    </div>
  );
}
