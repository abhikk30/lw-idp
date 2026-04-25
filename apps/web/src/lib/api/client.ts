"use client";

import type { paths } from "@lw-idp/contracts/gateway";
import createClient, { type Client } from "openapi-fetch";

let cached: Client<paths> | undefined;

/**
 * Browser openapi-fetch client. Same-origin requests against the ingress —
 * the `lw-sid` cookie is auto-attached. Returns a singleton.
 */
export function apiClient(): Client<paths> {
  if (!cached) {
    cached = createClient<paths>({
      baseUrl: "/api/v1",
      credentials: "same-origin",
    });
  }
  return cached;
}
