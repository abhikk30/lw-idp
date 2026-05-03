import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SecurityTab } from "../../../../../components/security/security-tab.client.js";
import { createServerClient } from "../../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ServiceSecurityPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;
  const client = await createServerClient();
  const { data } = await client.GET("/services/{id}", { params: { path: { id } } });
  if (!data) {
    notFound();
  }
  return <SecurityTab serviceSlug={data.slug} />;
}
