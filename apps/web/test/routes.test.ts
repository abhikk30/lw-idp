import { describe, expect, it } from "vitest";
import { GET as healthzGet } from "../src/app/api/healthz/route.js";
import { GET as readyzGet } from "../src/app/api/readyz/route.js";

describe("web route handlers", () => {
  it("/api/healthz returns {status:ok, service:web}", async () => {
    const res = healthzGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "web" });
  });

  it("/api/readyz returns {status:ready, service:web}", async () => {
    const res = readyzGet();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", service: "web" });
  });
});
