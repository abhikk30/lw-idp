import type { paths } from "@lw-idp/contracts/gateway";
import { headers } from "next/headers";
import createClient, { type Client } from "openapi-fetch";

const INTERNAL_BASE_URL =
  process.env.GATEWAY_INTERNAL_URL ?? "http://gateway-svc.lw-idp.svc.cluster.local/api/v1";

/**
 * Build an openapi-fetch Client for use in Server Components and Route Handlers.
 *
 * The client targets the gateway's INTERNAL DNS endpoint (no ingress hop),
 * forwards the inbound request's `lw-sid` cookie so the gateway sees the
 * authenticated session, and returns typed responses from the OpenAPI spec.
 *
 * Must only be called inside RSC / Route Handlers / Server Actions —
 * `next/headers` throws on the client.
 */
export async function createServerClient(): Promise<Client<paths>> {
  const reqHeaders = await headers();
  const cookie = reqHeaders.get("cookie") ?? "";

  return createClient<paths>({
    baseUrl: INTERNAL_BASE_URL,
    headers: cookie ? { cookie } : {},
  });
}
