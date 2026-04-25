import type { ReactNode } from "react";
import {
  ServiceForm,
  type TeamOption,
} from "../../../../components/services/service-form.client.js";
import { createServerClient } from "../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

async function loadTeams(): Promise<TeamOption[]> {
  const client = await createServerClient();
  const { data } = await client.GET("/teams");
  // From the A5 finding: /teams returns { teams } (NOT { items }).
  const items = (data?.teams ?? []) as Array<{ id: string; slug: string; name: string }>;
  return items.map((t) => ({ id: t.id, slug: t.slug, name: t.name }));
}

export default async function NewServicePage(): Promise<ReactNode> {
  const teams = await loadTeams();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Register service</h1>
        <p className="text-muted-foreground mt-1 text-sm">Add a new service to the catalog.</p>
      </div>
      <ServiceForm teams={teams} />
    </div>
  );
}
