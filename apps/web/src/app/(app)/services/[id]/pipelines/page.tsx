import { Badge } from "@lw-idp/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import type { ReactNode } from "react";
import { PipelinesTable } from "../../../../../components/mocked/pipelines-table.client.js";
import { getPipelineAdapter } from "../../../../../lib/adapters/index.js";
import { createServerClient } from "../../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PipelinesPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;
  const client = await createServerClient();
  const { data: service } = await client.GET("/services/{id}", { params: { path: { id } } });
  const slug = service?.slug ?? id;

  const adapter = getPipelineAdapter();
  const { items } = await adapter.list(slug);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Pipelines</CardTitle>
          <CardDescription>Recent CI runs for this service.</CardDescription>
        </div>
        <Badge variant="outline">mock data</Badge>
      </CardHeader>
      <CardContent>
        <PipelinesTable pipelines={items} />
      </CardContent>
    </Card>
  );
}
