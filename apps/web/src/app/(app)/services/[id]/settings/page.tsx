import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ServiceDeleteButton } from "../../../../../components/services/service-delete-button.client.js";
import { ServiceEditForm } from "../../../../../components/services/service-edit-form.client.js";
import type { TeamOption } from "../../../../../components/services/service-form.client.js";
import { createServerClient } from "../../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ServiceSettingsPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;
  const client = await createServerClient();
  const [serviceRes, teamsRes] = await Promise.all([
    client.GET("/services/{id}", { params: { path: { id } } }),
    client.GET("/teams"),
  ]);

  const service = serviceRes.data;
  if (!service) {
    notFound();
  }

  const teams: TeamOption[] = (
    (teamsRes.data?.teams ?? []) as Array<{ id: string; slug: string; name: string }>
  ).map((t) => ({ id: t.id, slug: t.slug, name: t.name }));

  async function deleteService(): Promise<{ ok: true } | { ok: false; message: string }> {
    "use server";
    const c = await createServerClient();
    const { error } = await c.DELETE("/services/{id}", {
      params: { path: { id } },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    if (error) {
      const msg =
        (error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message)
          : null) ?? "Failed to delete service";
      return { ok: false, message: msg };
    }
    redirect("/services");
  }

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Edit service</CardTitle>
          <CardDescription>Slug, name, and type are immutable.</CardDescription>
        </CardHeader>
        <CardContent>
          <ServiceEditForm service={service} teams={teams} />
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Delete this service. This action is permanent.</CardDescription>
        </CardHeader>
        <CardContent>
          <ServiceDeleteButton id={service.id} name={service.name} deleteAction={deleteService} />
        </CardContent>
      </Card>
    </div>
  );
}
