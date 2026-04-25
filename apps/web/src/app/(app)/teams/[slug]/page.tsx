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
  params: Promise<{ slug: string }>;
}

export default async function TeamDetailPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/teams", {});
  const teams = (data?.teams ?? []) as Array<{ id: string; slug: string; name: string }>;
  const team = teams.find((t) => t.slug === slug);
  if (!team) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{team.name}</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">{team.slug}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>Membership management lands in P1.9 (RBAC).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[8rem_1fr] items-center gap-2">
            <span className="text-muted-foreground text-sm">Team ID</span>
            <code className="text-xs">{team.id}</code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
