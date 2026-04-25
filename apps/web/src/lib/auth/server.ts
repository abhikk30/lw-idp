import "server-only";

import type { paths } from "@lw-idp/contracts/gateway";
import { createServerClient } from "../api/server.js";

export type Me = NonNullable<
  paths["/me"]["get"]["responses"]["200"]["content"]["application/json"]
>;

/**
 * Fetch the current user + teams from gateway-svc /me.
 * Returns undefined when the session is missing/expired (gateway → 401).
 *
 * Must only be called from RSC / Server Actions / Route Handlers.
 */
export async function getServerSession(): Promise<Me | undefined> {
  const client = await createServerClient();
  const { data, response } = await client.GET("/me", {});
  if (response.status === 401 || !data) {
    return undefined;
  }
  return data;
}
