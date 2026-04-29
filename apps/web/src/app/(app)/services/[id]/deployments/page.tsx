import type { ArgoApplication } from "@lw-idp/contracts";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DeploymentsPanel } from "../../../../../components/deployments/deployments-panel.client.js";
import { getArgoCdAdapter } from "../../../../../lib/adapters/index.js";
import { createServerClient } from "../../../../../lib/api/server.js";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Per-service deployments page.
 *
 * P2.0 E3: rewritten from the previous mock `DeploymentsTable` to render the
 * live Argo CD Application status. The `DeploymentAdapter` mock is preserved
 * elsewhere (re-used by P2.1). Argo CD Application name is the service slug.
 *
 * Behaviour on adapter failure:
 *  - 404 / "not_found" → Next.js notFound() (renders the standard 404).
 *  - any other error   → renders an inline empty-state alert; user can retry.
 */
export default async function DeploymentsPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;

  // Resolve the service slug — Argo CD Application name == slug.
  const client = await createServerClient();
  const { data: service } = await client.GET("/services/{id}", { params: { path: { id } } });
  const slug = service?.slug ?? id;

  const adapter = await getArgoCdAdapter();
  let initialApplication: ArgoApplication;
  try {
    initialApplication = await adapter.getApplication(slug);
  } catch (err) {
    if (err instanceof Error && /not_found|404/i.test(err.message)) {
      notFound();
    }
    return (
      <div role="alert" className="text-muted-foreground rounded-md border p-4 text-sm">
        Deploy plane unavailable — please retry.
      </div>
    );
  }

  return <DeploymentsPanel initialApplication={initialApplication} serviceSlug={slug} />;
}
