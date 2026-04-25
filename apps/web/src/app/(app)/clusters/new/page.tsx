import type { ReactNode } from "react";
import { ClusterForm } from "../../../../components/clusters/cluster-form.client.js";

export const dynamic = "force-dynamic";

export default function NewClusterPage(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Register cluster</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Add a managed Kubernetes cluster to lw-idp.
        </p>
      </div>
      <ClusterForm />
    </div>
  );
}
