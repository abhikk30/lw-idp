import { Card, CardContent, CardHeader, CardTitle } from "@lw-idp/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@lw-idp/ui/components/table";
import Link from "next/link";
import type { ReactNode } from "react";
import { createServerClient } from "../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface TeamRow {
  id: string;
  slug: string;
  name: string;
}

async function loadTeams(): Promise<TeamRow[]> {
  const client = await createServerClient();
  const { data } = await client.GET("/teams", {});
  // /teams returns { teams } per OpenAPI (A5 finding)
  const teams = (data?.teams ?? []) as Array<{ id: string; slug: string; name: string }>;
  return teams.map((t) => ({ id: t.id, slug: t.slug, name: t.name }));
}

export default async function TeamsPage(): Promise<ReactNode> {
  const teams = await loadTeams();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The teams that own services and clusters.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{teams.length} teams</CardTitle>
        </CardHeader>
        <CardContent>
          {teams.length === 0 ? (
            <p className="text-muted-foreground text-sm">No teams yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/teams/${t.slug}`}
                        className="text-primary font-mono text-sm hover:underline"
                      >
                        {t.slug}
                      </Link>
                    </TableCell>
                    <TableCell>{t.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
