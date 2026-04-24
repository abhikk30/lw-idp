import { type Client, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { IdentityService } from "@lw-idp/contracts/identity/v1";

export function createIdentityClient(baseUrl: string): Client<typeof IdentityService> {
  const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
  return createClient(IdentityService, transport);
}

export type IdentityClient = Client<typeof IdentityService>;
