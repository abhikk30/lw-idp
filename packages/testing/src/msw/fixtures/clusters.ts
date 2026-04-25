import type { paths } from "@lw-idp/contracts/gateway";

type ClusterList = NonNullable<
  paths["/clusters"]["get"]["responses"]["200"]["content"]["application/json"]
>;
export type ClusterItem = ClusterList["items"][number];

export const clustersFixture: ClusterItem[] = [
  {
    id: "cl-prod-us-east",
    slug: "prod-us-east",
    name: "Production US-East",
    environment: "prod",
    region: "us-east-1",
    provider: "eks",
    apiEndpoint: "https://kube.prod-us-east.lw-idp.internal:6443",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "cl-staging",
    slug: "staging",
    name: "Staging",
    environment: "stage",
    region: "us-east-1",
    provider: "kind",
    apiEndpoint: "https://kube.staging.lw-idp.internal:6443",
    createdAt: "2026-02-10T00:00:00Z",
  },
];
