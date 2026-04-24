import { type Client, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { ClusterService } from "@lw-idp/contracts/cluster/v1";

export function createClusterClient(baseUrl: string): Client<typeof ClusterService> {
  const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
  return createClient(ClusterService, transport);
}

export type ClusterClient = Client<typeof ClusterService>;
