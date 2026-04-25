import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST } from "../src/app/auth/logout/route.js";

const server = setupServer(
  http.post("http://test-gw.local/auth/logout", () => HttpResponse.json({ ok: true })),
);

beforeAll(() => {
  server.listen();
  process.env.GATEWAY_INTERNAL_URL = "http://test-gw.local";
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("/auth/logout POST", () => {
  it("forwards cookie to gateway, clears cookie, 303 redirects to /auth/login", async () => {
    const req = new NextRequest(new URL("http://localhost:3001/auth/logout"), {
      method: "POST",
      headers: { cookie: "lw-sid=sess_abc" },
    });
    const res = await POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/auth/login");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/lw-sid=;/);
    expect(setCookie.toLowerCase()).toContain("max-age=0");
  });

  it("still clears cookie when upstream fetch fails (network error)", async () => {
    server.use(http.post("http://test-gw.local/auth/logout", () => HttpResponse.error()));
    const req = new NextRequest(new URL("http://localhost:3001/auth/logout"), {
      method: "POST",
      headers: { cookie: "lw-sid=sess_abc" },
    });
    const res = await POST(req);
    expect(res.status).toBe(303);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/lw-sid=;/);
  });
});
