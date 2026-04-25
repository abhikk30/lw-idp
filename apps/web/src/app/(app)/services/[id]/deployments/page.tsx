import { Badge } from "@lw-idp/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import type { ReactNode } from "react";
import { DeploymentsTable } from "../../../../../components/mocked/deployments-table.client.js";
import { getDeploymentAdapter } from "../../../../../lib/adapters/index.js";
import { createServerClient } from "../../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DeploymentsPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;
  const client = await createServerClient();
  const { data: service } = await client.GET("/services/{id}", { params: { path: { id } } });
  const slug = service?.slug ?? id;

  const adapter = getDeploymentAdapter();
  const { items } = await adapter.list(slug);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Deployments</CardTitle>
          <CardDescription>Latest rollout activity for this service.</CardDescription>
        </div>
        <Badge variant="outline">mock data</Badge>
      </CardHeader>
      <CardContent>
        <DeploymentsTable deployments={items} />
      </CardContent>
    </Card>
  );
}
