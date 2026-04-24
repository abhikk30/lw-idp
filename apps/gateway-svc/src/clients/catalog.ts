import { type Client, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { CatalogService } from "@lw-idp/contracts/catalog/v1";

export function createCatalogClient(baseUrl: string): Client<typeof CatalogService> {
  const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
  return createClient(CatalogService, transport);
}

export type CatalogClient = Client<typeof CatalogService>;
